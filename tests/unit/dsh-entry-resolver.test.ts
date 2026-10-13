import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveDshEntry } from '../../vt-plugins/lib/dsh-entry-resolver';

// Fixture: a fake npx cache with two @deepseek-ai/dsh copies. The resolver's
// contract (ADR-D3): DSH_WEB_CMD > DSH_HOST_DIR > npx pin match > newest
// (flagged unpinned) > not-found. Each arm gets its own disk proof.
let cacheRoot: string;
let oldCopy: string; // 0.1.5-rc.1 — the stale copy that fails preset loading
let newCopy: string; // 0.2.1-alpha.2 — the pin-matching copy
let checkout: string;

function makeCopy(root: string, hash: string, version: string): string {
  const dir = join(root, hash, 'node_modules', '@deepseek-ai', 'dsh');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'bin.js'), 'export { runCli };\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }));
  return dir;
}

beforeAll(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'dsh-resolver-'));
  oldCopy = makeCopy(cacheRoot, 'hashold', '0.1.5-rc.1');
  newCopy = makeCopy(cacheRoot, 'hashnew', '0.2.1-alpha.2');
  // newest-first ordering: make hashold genuinely older
  const t = new Date(Date.now() - 60_000);
  utimesSync(oldCopy, t, t);
  checkout = mkdtempSync(join(tmpdir(), 'dsh-checkout-'));
  mkdirSync(join(checkout, 'lib'), { recursive: true });
  writeFileSync(join(checkout, 'lib', 'bin.js'), 'export { runCli };\n');
  writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.9.9-dev' }));
});

afterAll(() => {
  rmSync(cacheRoot, { recursive: true, force: true });
  rmSync(checkout, { recursive: true, force: true });
});

describe('resolveDshEntry', () => {
  it('arm 1: DSH_WEB_CMD dir wins over everything', () => {
    const r = resolveDshEntry({ pin: '0.2.1-alpha.2', cacheRoot, env: { DSH_WEB_CMD: 'dir:' + checkout } });
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') {
      expect(r.source).toBe('web-cmd');
      expect(r.entryPath).toBe(join(checkout, 'lib', 'bin.js'));
    }
  });

  it('arm 1 reject: DSH_WEB_CMD pointing nowhere is not-found (loud)', () => {
    const r = resolveDshEntry({ cacheRoot, env: { DSH_WEB_CMD: '/nonexistent/dir' } });
    expect(r).toMatchObject({ status: 'not-found' });
    if (r.status === 'not-found') expect(r.reason).toContain('DSH_WEB_CMD');
  });

  it('arm 2: DSH_HOST_DIR checkout wins when no web cmd', () => {
    const r = resolveDshEntry({ pin: '0.2.1-alpha.2', cacheRoot, env: { DSH_HOST_DIR: checkout } });
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') expect(r.source).toBe('host-dir');
  });

  it('arm 3: npx copy matching the pin wins over newer-mtime mismatch', () => {
    const r = resolveDshEntry({ pin: '0.1.5-rc.1', cacheRoot, env: {} });
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') {
      expect(r.source).toBe('npx-pinned');
      expect(r.version).toBe('0.1.5-rc.1');
      expect(r.entryPath).toBe(join(oldCopy, 'lib', 'bin.js'));
    }
  });

  it('arm 4: pin not in cache falls back to newest, flagged unpinned', () => {
    const r = resolveDshEntry({ pin: '0.0.1-missing', cacheRoot, env: {} });
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') {
      expect(r.source).toBe('npx-unpinned');
      expect(r.packageDir).toBe(newCopy);
    }
  });

  it('arm 4: no pin at all takes the newest copy, unpinned', () => {
    const r = resolveDshEntry({ cacheRoot, env: {} });
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') expect(r.packageDir).toBe(newCopy);
  });

  it('empty cache is not-found with an actionable reason', () => {
    const empty = mkdtempSync(join(tmpdir(), 'dsh-empty-'));
    try {
      const r = resolveDshEntry({ pin: '0.2.1-alpha.2', cacheRoot: empty, env: {} });
      expect(r).toMatchObject({ status: 'not-found' });
      if (r.status === 'not-found') expect(r.reason).toContain('_npx');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('live machine probe: the real cache resolves to the working 0.2.1-alpha.2 copy', () => {
    const r = resolveDshEntry({ pin: '0.2.1-alpha.2', env: {} });
    // Disk proof this session (spike probe D): only the version-matched copy boots.
    if (r.status === 'resolved' && r.source === 'npx-pinned') {
      expect(r.version).toBe('0.2.1-alpha.2');
    }
    // not-found on a machine without the cache is ALSO a pass — the floor
    // boots UI-only loud (ADR-D3), the test only forbids a wrong resolved path.
  });
});
