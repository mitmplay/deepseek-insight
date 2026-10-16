/**
 * dsh-token-sink — write dsh.authToken into DSI's settings.yaml.
 *
 * ADR: dev/architectural-decission/2026-10/2026-10-11 - The In-Process Host (D2).
 * Same semantics as scripts/dsh-web-synced.sh update_token, moved in-process:
 * merge into the existing dsh section, atomic tmp+rename, byte-identical
 * token is a no-op (no mtime churn). A present-but-unparseable file fails
 * LOUD — a silent skip would leave DSI dialing a dead token forever.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';

// Load yaml from DSI's own node_modules — the plugin runs inside DSI's vite
// process, but keep the createRequire pattern so unit tests can run standalone.
let parseFn: ((s: string) => unknown) | undefined;
let stringifyFn: ((v: unknown) => string) | undefined;
function ensureYaml(): void {
  if (parseFn) return;
  const req = createRequire(process.cwd() + '/package.json');
  ({ parse: parseFn, stringify: stringifyFn } = req('yaml') as {
    parse: (s: string) => unknown;
    stringify: (v: unknown) => string;
  });
}

export interface TokenWriteResult {
  ok: boolean;
  /** 'written' — token saved over an existing file; 'noop' — byte-identical
   *  token, file untouched; 'created' — file did not exist and was created. */
  action: 'written' | 'noop' | 'created';
  error?: string;
}

export function writeAuthToken(
  token: string,
  configPath: string
): TokenWriteResult {
  ensureYaml();
  if (!token) return { ok: false, action: 'noop', error: 'empty token' };

  const existed = existsSync(configPath);
  let doc: Record<string, unknown> = {};

  if (existed) {
    let raw: string;
    try {
      raw = readFileSync(configPath, 'utf-8');
    } catch (e) {
      return { ok: false, action: 'noop', error: 'read failed: ' + (e as Error).message };
    }
    if (raw.trim() !== '') {
      try {
        const parsed = parseFn!(raw);
        if (parsed === null || parsed === undefined) {
          doc = {};
        } else if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          doc = parsed as Record<string, unknown>;
        } else {
          return { ok: false, action: 'noop', error: 'settings.yaml is not a YAML mapping' };
        }
      } catch (e) {
        return { ok: false, action: 'noop', error: 'cannot parse settings.yaml: ' + (e as Error).message };
      }
    }

    // Byte-identical no-op: same token already stored — no mtime churn.
    const existing = (doc as { dsh?: { authToken?: unknown } }).dsh?.authToken;
    if (existing === token) return { ok: true, action: 'noop' };

    doc.dsh = { ...((doc.dsh as object | undefined) ?? {}), authToken: token };
  } else {
    doc = { dsh: { authToken: token } };
  }

  // Atomic write: tmp in the SAME directory (rename must stay on one
  // filesystem), then rename over the target.
  const tmp = configPath + '.tmp-token-' + process.pid;
  try {
    writeFileSync(tmp, stringifyFn!(doc));
    renameSync(tmp, configPath);
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* tmp already gone — fine */ }
    return { ok: false, action: 'noop', error: 'write failed: ' + (e as Error).message };
  }
  return { ok: true, action: existed ? 'written' : 'created' };
}
