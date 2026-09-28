/**
 * api/plugins/reload — error-path + method-shape coverage that the shared
 * api-plugins-routes suite does not need: the engine-throw branch maps to a
 * 503 with a stringified error, and the success path omits `errors` when
 * the refresh came back clean.
 */
// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

const refreshMock = vi.fn();
const starsMock: Record<string, number> = {};

vi.mock('$lib/server/plugins/engine', () => ({
  getRackEngine: () => ({ refresh: refreshMock })
}));

vi.mock('$lib/server/plugins/stars', () => ({
  fetchRackStars: vi.fn(async () => starsMock)
}));

import { POST as reloadPOST } from '../../src/routes/api/plugins/reload/+server';

beforeEach(() => {
  refreshMock.mockReset();
  for (const k of Object.keys(starsMock)) delete starsMock[k];
});

describe('POST /api/plugins/reload', () => {
  it('clean refresh: ok snapshot, no errors key', async () => {
    refreshMock.mockResolvedValue({ snapshot: { v: 2, plugins: [{ id: 'p1' }] }, reused: false });
    const res = await reloadPOST({} as never);
    expect(res.status).toBe(200);
    expect(refreshMock).toHaveBeenCalledWith(true);
    const body = await res.json();
    expect(body).toEqual({ ok: true, snapshot: { v: 2, plugins: [{ id: 'p1' }] }, stars: {} });
    expect('errors' in body).toBe(false);
  });
  it('refresh with errors carries them through next to the snapshot', async () => {
    refreshMock.mockResolvedValue({ snapshot: { v: 3, plugins: [] }, reused: false, errors: ['reff-empty: no plugin lines found'] });
    const res = await reloadPOST({} as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, snapshot: { v: 3, plugins: [] }, stars: {}, errors: ['reff-empty: no plugin lines found'] });
  });
  it('engine failure maps to 503 with the stringified message', async () => {
    refreshMock.mockRejectedValue(new Error('rack engine not found'));
    const res = await reloadPOST({} as never);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'rack engine not found' });
  });
  it('a non-Error rejection still stringifies', async () => {
    refreshMock.mockRejectedValue({ message: 'weird' });
    const res = await reloadPOST({} as never);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
  });
});
