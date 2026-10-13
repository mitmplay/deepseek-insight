/**
 * dsh-entry-resolver — resolve the DSH web entry to a loadable absolute path.
 *
 * ADR: dev/architectural-decission/2026-10/2026-10-11 - The In-Process Host (D3).
 * The published DSH package is NOT resolvable from DSI's node_modules (probe,
 * 2026-10-11: createRequire(DSI/package.json).resolve('@deepseek-ai/dsh')
 * fails); it lives in the npx cache under a content hash. Resolution order:
 *   1. DSH_WEB_CMD          — "dir:/path/to/dir" pointing at a dsh package root
 *   2. DSH_HOST_DIR         — env var, a dsh package root (checkout)
 *   3. npx cache            — ~/.npm/_npx/<hash>/node_modules/@deepseek-ai/dsh,
 *                             newest mtime whose version matches the pin
 *   4. any npx cache copy   — version mismatch tolerated, flagged loud
 * Anything else → { status: 'not-found' } — the caller boots UI-only, loud.
 */
import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

export type EntrySource = 'web-cmd' | 'host-dir' | 'npx-pinned' | 'npx-unpinned';

export interface ResolvedEntry {
  status: 'resolved';
  entryPath: string;
  packageDir: string;
  version: string;
  source: EntrySource;
}

export interface UnresolvedEntry {
  status: 'not-found';
  reason: string;
}

export type EntryResolution = ResolvedEntry | UnresolvedEntry;

const PKG = join('@deepseek-ai', 'dsh');
const ENTRY = join('lib', 'bin.js');

function packageVersion(packageDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8'));
    return typeof pkg?.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/** Enumerate every @deepseek-ai/dsh copy in the npx cache, newest first. */
function npxCacheCopies(cacheRoot: string): { dir: string; mtime: number }[] {
  if (!existsSync(cacheRoot)) return [];
  const out: { dir: string; mtime: number }[] = [];
  for (const hash of readdirSync(cacheRoot)) {
    const dir = join(cacheRoot, hash, 'node_modules', ...PKG.split('/'));
    if (existsSync(join(dir, ENTRY))) {
      try {
        out.push({ dir, mtime: statSync(dir).mtimeMs });
      } catch {
        // unreadable copy — the loop keeps going, resolver reports what it saw
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** True when the dir really contains a loadable dsh entry (not a stub). */
function loadable(packageDir: string): boolean {
  return existsSync(join(packageDir, ENTRY));
}

export function resolveDshEntry(options: {
  pin?: string;
  env?: NodeJS.ProcessEnv;
  /** Test seam: overrides ~/.npm/_npx. */
  cacheRoot?: string;
} = {}): EntryResolution {
  const env = options.env ?? process.env;
  const pin = options.pin ?? null;
  const cacheRoot = options.cacheRoot ?? join(homedir(), '.npm', '_npx');

  // 1. DSH_WEB_CMD — the sync script treats this as a full command; the
  //    resolver accepts a "dir:<path>" or bare <path> package root.
  const webCmd = env.DSH_WEB_CMD;
  if (webCmd) {
    const dir = resolve(webCmd.startsWith('dir:') ? webCmd.slice(4).trim() : webCmd.trim());
    if (loadable(dir)) {
      return {
        status: 'resolved',
        entryPath: join(dir, ENTRY),
        packageDir: dir,
        version: packageVersion(dir) ?? 'unknown',
        source: 'web-cmd'
      };
    }
    return { status: 'not-found', reason: `DSH_WEB_CMD set but no ${ENTRY} under ${dir}` };
  }

  // 2. DSH_HOST_DIR — explicit checkout override.
  const hostDir = env.DSH_HOST_DIR;
  if (hostDir) {
    const dir = resolve(hostDir);
    if (loadable(dir)) {
      return {
        status: 'resolved',
        entryPath: join(dir, ENTRY),
        packageDir: dir,
        version: packageVersion(dir) ?? 'unknown',
        source: 'host-dir'
      };
    }
    return { status: 'not-found', reason: `DSH_HOST_DIR set but no ${ENTRY} under ${dir}` };
  }

  // 3+4. npx cache — prefer a copy whose version matches the pin exactly;
  //       fall back to newest with a loud "unpinned" flag for the caller.
  const copies = npxCacheCopies(cacheRoot);
  if (copies.length === 0) {
    return { status: 'not-found', reason: 'no @deepseek-ai/dsh copy in the npx cache (~/.npm/_npx) — run the tandem floor once (dsi dsh --sync) to populate it, or set DSH_HOST_DIR' };
  }
  if (pin) {
    const pinned = copies.find((c) => packageVersion(c.dir) === pin);
    if (pinned) {
      return {
        status: 'resolved',
        entryPath: join(pinned.dir, ENTRY),
        packageDir: pinned.dir,
        version: pin,
        source: 'npx-pinned'
      };
    }
    const newest = copies[0];
    return {
      status: 'resolved',
      entryPath: join(newest.dir, ENTRY),
      packageDir: newest.dir,
      version: packageVersion(newest.dir) ?? 'unknown',
      source: 'npx-unpinned'
    };
  }
  const newest = copies[0];
  return {
    status: 'resolved',
    entryPath: join(newest.dir, ENTRY),
    packageDir: newest.dir,
    version: packageVersion(newest.dir) ?? 'unknown',
    source: 'npx-unpinned'
  };
}

/** Convenience for tests: read a pin straight out of a package.json buffer. */
export function readPinFromPackageJson(packageJsonPath: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return typeof pkg?.dsh?.webVersion === 'string' ? pkg.dsh.webVersion : null;
  } catch {
    return null;
  }
}

// createRequire re-exported so the vite plugin can resolve without a second
// import site (Shared Layer rule: one resolver, one require factory).
export { createRequire };
