// 2.2-T - route handlers against a mocked engine runner.
import { beforeEach, describe, expect, it } from 'vitest';

import { setEngineRunner } from '../../../../src/lib/server/skills/engine';
import { GET as getSnapshot } from '../../../../src/routes/api/skills/snapshot/+server';
import { POST as postInstall } from '../../../../src/routes/api/skills/install/+server';
import { POST as postUninstall } from '../../../../src/routes/api/skills/uninstall/+server';
import { POST as postReload } from '../../../../src/routes/api/skills/reload/+server';

const SNAP = {
  v: 1,
  generatedAt: 't',
  sources: [
    { id: 'pstack', name: 'pstack', author: 'a', repo: 'r', skills: [
      { n: '1.1', id: 'signed-one', path: 'p', tier: null, installed: true, signed: true, installedFrom: 'pstack' },
      { n: '1.2', id: 'unsigned-one', path: 'p', tier: null, installed: true, signed: false, installedFrom: null },
      { n: '1.3', id: 'absent-one', path: 'p', tier: null, installed: false, signed: false, installedFrom: null }
    ] }
  ]
};

const req = (body: unknown) => new Request('http://x/', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => setEngineRunner(null));

describe('GET /api/skills/snapshot', () => {
  it('builds when absent, returns uninstallable signed-only list', async () => {
    const calls: string[][] = [];
    setEngineRunner(async (_p: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'snapshot-status') return JSON.stringify({ v: 1, ok: true, present: false });
      return JSON.stringify({ v: 1, ok: true, reused: false, snapshot: SNAP });
    });
    const res = await getSnapshot({} as never);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reused).toBe(false);
    expect(body.uninstallable).toEqual(['signed-one']);
    expect(calls.some((a) => a[0] === 'refresh')).toBe(true);
  });

  it('engine failure maps to 503', async () => {
    setEngineRunner(async () => { throw new Error('boom'); });
    const res = await getSnapshot({} as never);
    expect(res.status).toBe(503);
  });
});

describe('POST /api/skills/install', () => {
  it('happy path returns per-target results', async () => {
    setEngineRunner(async (_p: string, args: string[]) => {
      if (args[0] === 'apply') return JSON.stringify({ v: 1, ok: true, results: [{ n: '1.3', ok: true }] });
      return JSON.stringify({ v: 1, ok: true, present: true });
    });
    const res = await postInstall({ request: req({ targets: ['1.3'] }) } as never);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.results[0].n).toBe('1.3');
  });

  it('malformed body 400', async () => {
    const res = await postInstall({ request: req({ nope: 1 }) } as never);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/skills/uninstall', () => {
  it('unsigned target maps to 409 with results (D5)', async () => {
    setEngineRunner(async () => JSON.stringify({ v: 1, ok: false, results: [{ id: 'unsigned-one', ok: false, error: 'unsigned - not uninstallable via shelf (D5)' }] }));
    const res = await postUninstall({ request: req({ ids: ['unsigned-one'] }) } as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.results[0].error).toContain('unsigned');
  });

  it('signed uninstall is 200 ok', async () => {
    setEngineRunner(async () => JSON.stringify({ v: 1, ok: true, results: [{ id: 'signed-one', ok: true }] }));
    const res = await postUninstall({ request: req({ ids: ['signed-one'] }) } as never);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/skills/reload', () => {
  it('forces refresh --reload and returns fresh snapshot', async () => {
    const calls: string[][] = [];
    setEngineRunner(async (_p: string, args: string[]) => {
      calls.push(args);
      return JSON.stringify({ v: 1, ok: true, reused: false, snapshot: SNAP });
    });
    const res = await postReload({} as never);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(calls[0]).toContain('--reload');
  });
});
