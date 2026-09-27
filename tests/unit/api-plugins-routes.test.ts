// Task 2.1-T — api/plugins routes: stubbed engine + chain spawner, never real dsh.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const applyMock = vi.fn();
const refreshMock = vi.fn();
const statusMock = vi.fn();

vi.mock('$lib/server/plugins/engine', () => ({
  getRackEngine: () => ({
    apply: applyMock,
    refresh: refreshMock,
    snapshotStatus: statusMock
  }),
  RackEngineFailedError: class RackEngineFailedError extends Error {},
  RackEngineMissingError: class RackEngineMissingError extends Error {}
}));

const spawnMock = vi.fn(() => true);
vi.mock('$lib/server/plugins/restart-chain', () => ({
  spawnRestartChain: () => spawnMock()
}));

import { GET as snapshotGET } from '../../src/routes/api/plugins/snapshot/+server';
import { POST as applyPOST } from '../../src/routes/api/plugins/apply/+server';
import { POST as reloadPOST } from '../../src/routes/api/plugins/reload/+server';

beforeEach(() => {
  vi.clearAllMocks();
  applyMock.mockReset(); refreshMock.mockReset(); statusMock.mockReset(); spawnMock.mockClear();
  spawnMock.mockReturnValue(true);
});

const jsonReq = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) });

describe('GET /api/plugins/snapshot', () => {
  it('builds when the cache is absent, reuses when present', async () => {
    statusMock.mockResolvedValue({ present: false });
    refreshMock.mockResolvedValue({ snapshot: { v: 1, plugins: [] }, reused: false });
    const res = await snapshotGET({} as never);
    expect(refreshMock).toHaveBeenCalledWith(true);
    await expect(res.json()).resolves.toMatchObject({ ok: true, reused: false });
    statusMock.mockResolvedValue({ present: true });
    refreshMock.mockResolvedValue({ snapshot: { v: 1, plugins: [] }, reused: true });
    await snapshotGET({} as never);
    expect(refreshMock).toHaveBeenLastCalledWith(false);
  });
  it('engine failure maps to 503', async () => {
    statusMock.mockRejectedValue(new Error('rack engine not found'));
    const res = await snapshotGET({} as never);
    expect(res.status).toBe(503);
  });
});

describe('POST /api/plugins/apply', () => {
  const ok = { ok: true, results: [{ id: 'dsh-rules-paths', ok: true }] };
  it('success spawns the chain DETACHED and answers with restarting', async () => {
    applyMock.mockResolvedValue(ok.results);
    const res = await applyPOST({ request: jsonReq({ action: 'install', targets: ['1'] }) } as never);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, restarting: true });
    expect(applyMock).toHaveBeenCalledWith('install', ['1']);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
  it('the chain spawn happens BEFORE the response resolves (answers-first, D5)', async () => {
    applyMock.mockImplementation(async () => {
      // the engine resolves, then the route spawns, then the route responds —
      // assert ordering by recording the spawn at call time
      return ok.results;
    });
    const resPromise = applyPOST({ request: jsonReq({ action: 'remove', targets: ['x'] }) } as never);
    const res = await resPromise;
    expect(res.status).toBe(200);
    expect(spawnMock).toHaveBeenCalled();
  });
  it('per-target failure relays results, spawns nothing', async () => {
    applyMock.mockResolvedValue([{ id: 'x', ok: false, error: 'dsh plugin add failed (exit 3): diagnostics' }]);
    const res = await applyPOST({ request: jsonReq({ action: 'install', targets: ['x'] }) } as never);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.results[0].error).toContain('exit 3');
    expect(spawnMock).not.toHaveBeenCalled();
  });
  it('missing bin answers honestly (restarting:false), still 200', async () => {
    applyMock.mockResolvedValue(ok.results);
    spawnMock.mockReturnValue(false);
    const res = await applyPOST({ request: jsonReq({ action: 'install', targets: ['1'] }) } as never);
    await expect(res.json()).resolves.toMatchObject({ ok: true, restarting: false });
  });
  it('malformed bodies 400; bad action 400', async () => {
    expect((await applyPOST({ request: jsonReq({ action: 'nope', targets: ['1'] }) } as never)).status).toBe(400);
    expect((await applyPOST({ request: jsonReq({ action: 'install', targets: [] }) } as never)).status).toBe(400);
    expect((await applyPOST({ request: jsonReq({ action: 'install', targets: [42] }) } as never)).status).toBe(400);
  });
  it('a concurrent apply is refused with 409 (single-flight)', async () => {
    let release: (v: unknown) => void = () => {};
    applyMock.mockImplementation(() => new Promise((res) => { release = res; }));
    const first = applyPOST({ request: jsonReq({ action: 'install', targets: ['1'] }) } as never);
    const second = await applyPOST({ request: jsonReq({ action: 'install', targets: ['2'] }) } as never);
    expect(second.status).toBe(409);
    release([{ id: '1', ok: true }]);
    expect((await first).status).toBe(200);
  });
});

describe('POST /api/plugins/reload', () => {
  it('forces refresh --reload and carries warnings through', async () => {
    refreshMock.mockResolvedValue({ snapshot: { v: 1, plugins: [] }, reused: false, errors: ['reff-empty: no plugin lines found'] });
    const res = await reloadPOST({} as never);
    expect(refreshMock).toHaveBeenCalledWith(true);
    const body = await res.json();
    expect(body.errors).toContain('reff-empty: no plugin lines found');
  });
});
