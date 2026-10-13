import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeAuthToken } from '../../vt-plugins/lib/dsh-token-sink';

// Contract (ADR-D2 / sync-script parity): merge dsh section, atomic tmp+rename,
// byte-identical no-op, corrupt YAML fails loud, empty target file is created.
let dir: string;

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'dsh-sink-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const yaml = (s: string) => join(dir, s);

describe('writeAuthToken', () => {
  it('creates a missing settings file with the dsh section', () => {
    const p = yaml('missing.yaml');
    const r = writeAuthToken('tok-1', p);
    expect(r).toMatchObject({ ok: true, action: 'created' });
    expect(readFileSync(p, 'utf-8')).toContain('tok-1');
    expect(readFileSync(p, 'utf-8')).toContain('authToken');
  });

  it('merges into an existing doc, preserving sibling sections', () => {
    const p = yaml('existing.yaml');
    writeFileSync(p, 'chat:\n  maxRows: 12\nserver:\n  ringCapacity: 500\n');
    const r = writeAuthToken('tok-2', p);
    expect(r).toMatchObject({ ok: true, action: 'written' });
    const out = readFileSync(p, 'utf-8');
    expect(out).toContain('tok-2');
    expect(out).toContain('maxRows: 12');      // sibling survives
    expect(out).toContain('ringCapacity: 500'); // sibling survives
  });

  it('byte-identical token is a noop — mtime untouched', async () => {
    const p = yaml('noop.yaml');
    writeAuthToken('tok-3', p);
    const m1 = statSync(p).mtimeMs;
    // mtime granularity can be coarse; force a distinguishable past mtime
    const past = new Date(Date.now() - 5_000);
    utimes(p, past, past);
    const m2 = statSync(p).mtimeMs;
    const r = writeAuthToken('tok-3', p);
    expect(r).toMatchObject({ ok: true, action: 'noop' });
    expect(statSync(p).mtimeMs).toBe(m2);
  });

  it('replaces a stale token on reboot (the D2 race the sink exists for)', () => {
    const p = yaml('stale.yaml');
    writeAuthToken('old-token', p);
    const r = writeAuthToken('new-token', p);
    expect(r).toMatchObject({ ok: true, action: 'written' });
    const out = readFileSync(p, 'utf-8');
    expect(out).toContain('new-token');
    expect(out).not.toContain('old-token');
  });

  it('corrupt YAML fails LOUD and leaves the file untouched', () => {
    const p = yaml('corrupt.yaml');
    writeFileSync(p, '{ not: [valid\n  yaml::: broken');
    const r = writeAuthToken('tok-4', p);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('cannot parse');
    expect(readFileSync(p, 'utf-8')).toContain('broken'); // untouched
  });

  it('non-mapping YAML (a list) fails loud', () => {
    const p = yaml('list.yaml');
    writeFileSync(p, '- just\n- a\n- list\n');
    const r = writeAuthToken('tok-5', p);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not a YAML mapping');
  });

  it('empty token is rejected', () => {
    const r = writeAuthToken('', yaml('never.yaml'));
    expect(r.ok).toBe(false);
    expect(existsSync(yaml('never.yaml'))).toBe(false);
  });

  it('atomic: no .tmp-token litter left after a successful write', () => {
    const p = yaml('litter.yaml');
    writeAuthToken('tok-6', p);
    const litter = readdirSync(dir).filter((f) => f.includes('.tmp-token-'));
    expect(litter).toEqual([]);
  });
});

// utimes helper: real node:fs function under a local alias
import { utimesSync as utimes } from 'node:fs';
