// api/plugins/apply — rejection-code mop: malformed JSON body, engine
// missing/failed 503s, foreign-error 500. Engine + chain are stubbed.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const applyMock = vi.fn();

vi.mock('$lib/server/plugins/engine', () => ({
  getRackEngine: () => ({ apply: applyMock, refresh: vi.fn(), snapshotStatus: vi.fn() })
}));

import { POST as applyPOST } from '../../src/routes/api/plugins/apply/+server';
import {
  RackEngineFailedError,
  RackEngineMissingError
} from '../../src/lib/server/plugins/types';

const req = (init?: { body?: string }) =>
  new Request('http://x/api/plugins/apply', { method: 'POST', ...init });

const jsonReq = (body: unknown) => req({ body: JSON.stringify(body) });

beforeEach(() => {
  applyMock.mockReset();
  applyMock.mockResolvedValue([{ id: 'a', ok: true }]);
});

describe('POST /api/plugins/apply — rejection codes', () => {
  it('unparseable body is a 400 malformed-JSON rejection', async () => {
    const res = await applyPOST({ request: req({ body: '{nope' }) } as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'malformed JSON body' });
  });

  it('non-array targets is a 400', async () => {
    const res = await applyPOST({ request: jsonReq({ action: 'install', targets: 'a' }) } as never);
    expect(res.status).toBe(400);
  });

  it('empty-string targets are rejected as a 400', async () => {
    const res = await applyPOST({ request: jsonReq({ action: 'remove', targets: [''] }) } as never);
    expect(res.status).toBe(400);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('RackEngineMissingError maps to 503', async () => {
    applyMock.mockRejectedValue(new RackEngineMissingError('/absent/rack.mjs'));
    const res = await applyPOST({ request: jsonReq({ action: 'install', targets: ['1'] }) } as never);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'rack engine not found: /absent/rack.mjs' });
  });

  it('RackEngineFailedError maps to 503', async () => {
    applyMock.mockRejectedValue(new RackEngineFailedError('rack engine emitted non-JSON output', null));
    const res = await applyPOST({ request: jsonReq({ action: 'install', targets: ['1'] }) } as never);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: 'rack engine emitted non-JSON output' });
  });

  it('a foreign error maps to 500 with its message relayed', async () => {
    applyMock.mockRejectedValue(new TypeError('cannot read properties of undefined'));
    const res = await applyPOST({ request: jsonReq({ action: 'install', targets: ['1'] }) } as never);
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'cannot read properties of undefined' });
  });
});
