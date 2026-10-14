import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST, GET } from '../../src/routes/api/plugins/host-bounce/+server.ts';

// ADR-0025 D1/D3 route contract: localhost-only; 200 + { ok, bounced } when
// the surface verb reports success; 409 when no verb or the verb fails
// (the chain's cue to fall back to the whole-floor sweep); 403 remote.
const savedSurface = {
  g: (globalThis as { __dshHost?: unknown }).__dshHost,
  p: (process as { __DSH_HOST__?: unknown }).__DSH_HOST__
};
function setSurface(s: unknown): void {
  (globalThis as { __dshHost?: unknown }).__dshHost = s;
  (process as { __DSH_HOST__?: unknown }).__DSH_HOST__ = s;
}
const LOCAL = { getClientAddress: () => '127.0.0.1' };
const REMOTE = { getClientAddress: () => '10.0.0.7' };

afterEach(() => {
  setSurface(null);
  (globalThis as { __dshHost?: unknown }).__dshHost = savedSurface.g;
  (process as { __DSH_HOST__?: unknown }).__DSH_HOST__ = savedSurface.p;
});

describe('POST /api/plugins/host-bounce', () => {
  beforeEach(() => setSurface(null));

  it('409 no-verb: runCli-mode floor (no bounce handle) tells the chain to sweep', async () => {
    setSurface({ status: 'running' }); // surface present, verb absent
    const res = await POST(LOCAL as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('fall back');
  });

  it('200: verb success answers { ok: true, bounced: true }', async () => {
    let called = 0;
    setSurface({ bounce: async () => { called += 1; return { ok: true }; } });
    const res = await POST(LOCAL as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, bounced: true });
    expect(called).toBe(1);
  });

  it('409 verb-failure carries the typed reason (port-held, boot-failed, …)', async () => {
    setSurface({ bounce: async () => ({ ok: false, reason: 'port-held' }) });
    const res = await POST(LOCAL as never);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('port-held');
  });

  it('403: the verb is localhost-only (process control, not network)', async () => {
    setSurface({ bounce: async () => ({ ok: true }) });
    const res = await POST(REMOTE as never);
    expect(res.status).toBe(403);
  });

  it('is POST-only (GET is not the bounce verb)', () => {
    expect(GET).toBeUndefined();
  });
});
