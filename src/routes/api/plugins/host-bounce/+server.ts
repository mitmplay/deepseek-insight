/**
 * POST /api/plugins/host-bounce — the Host-Level Bounce verb (ADR-0025, D1).
 *
 * The plugin-restart chain, after resolveBounceMode resolves in-process,
 * POSTs here INSTEAD of sweeping orphans: this route calls the embedded
 * host's bounce verb — stop the DSH host, wait for the port, re-boot
 * in-place — and the vite process NEVER dies. The route AWAITS the bounce
 * and answers with the typed result so the chain can decide the fallback
 * (D3): 200 ok = sweep skipped; 409 (no handle / bounce failed) = the
 * chain falls back to today's whole-floor sweep.
 *
 * Localhost-only: the verb is a process-control surface for the floor's
 * own chain, not for the network (guarded via getClientAddress).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface BounceSurface {
	bounce?: () => Promise<{ ok: boolean; reason?: string }>;
}

function bounceVerb(): (() => Promise<{ ok: boolean; reason?: string }>) | null {
	// Realm-proof read: expose() publishes on BOTH globalThis (main realm)
	// and process (every VM context) — prefer whichever carries the verb.
	const g = (globalThis as { __dshHost?: BounceSurface }).__dshHost;
	const p = (process as { __DSH_HOST__?: BounceSurface }).__DSH_HOST__;
	const bounce = g?.bounce ?? p?.bounce;
	return typeof bounce === 'function' ? bounce : null;
}

export const POST: RequestHandler = async ({ getClientAddress }) => {
	const addr = getClientAddress();
	const local = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
	if (!local) {
		return json({ ok: false, error: 'host-bounce is localhost-only' }, { status: 403 });
	}
	const bounce = bounceVerb();
	if (bounce === null) {
		return json(
			{ ok: false, error: 'no bounce verb (host not embedded or runCli mode) — fall back to the sweep' },
			{ status: 409 }
		);
	}
	const result = await bounce();
	if (!result.ok) {
		return json({ ok: false, error: result.reason ?? 'bounce failed' }, { status: 409 });
	}
	return json({ ok: true, bounced: true });
};
