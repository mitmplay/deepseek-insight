/**
 * api-plugins — POST /api/plugins/apply
 * Body: { action: 'install' | 'remove', targets: string[] }.
 * Engine apply runs the dsh work (D3); on overall success the DSH restart
 * chain (killOrphans + --sync re-serve) is spawned DETACHED and this route
 * answers FIRST — the DSI server itself is one of the orphans the sweep
 * kills, so the response can never wait for the bounce (ADR D5).
 * 400 on a malformed body, 409 on a concurrent apply, 503 on engine failure.
 */
import { json } from '@sveltejs/kit';

import { getRackEngine } from '$lib/server/plugins/engine';
import { RackEngineFailedError, RackEngineMissingError } from '$lib/server/plugins/types';
import { spawnRestartChain } from '$lib/server/plugins/restart-chain';
import type { RequestHandler } from './$types';

/** Single-flight (the shelf's reload precedent): a second concurrent apply
 *  JOINS nothing — it is refused; the floor bounces under it anyway. */
let inFlight = false;

export const POST: RequestHandler = async ({ request }) => {
	let body: { action?: unknown; targets?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'malformed JSON body' }, { status: 400 });
	}
	const action = body.action;
	const targets = body.targets;
	if (action !== 'install' && action !== 'remove') {
		return json({ ok: false, error: "action must be 'install' or 'remove'" }, { status: 400 });
	}
	if (!Array.isArray(targets) || targets.length === 0 || !targets.every((t) => typeof t === 'string' && t.length > 0)) {
		return json({ ok: false, error: 'targets must be a non-empty array of strings' }, { status: 400 });
	}
	if (inFlight) {
		return json({ ok: false, error: 'an apply is already in flight' }, { status: 409 });
	}
	inFlight = true;
	try {
		const results = await getRackEngine().apply(action, targets as string[]);
		const allOk = results.every((r) => r.ok);
		if (!allOk) return json({ ok: false, results });
		// Answers-first contract: the detached spawn must be issued BEFORE
		// this response returns; whether the chain could start is honest data.
		const restarting = spawnRestartChain();
		return json({ ok: true, results, restarting });
	} catch (err) {
		const status = err instanceof RackEngineMissingError || err instanceof RackEngineFailedError ? 503 : 500;
		return json({ ok: false, error: String((err as Error).message) }, { status });
	} finally {
		inFlight = false;
	}
};
