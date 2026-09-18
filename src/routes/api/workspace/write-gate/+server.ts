/**
 * api-workspace — GET /api/workspace/write-gate?sessionId=…
 *
 * The file panel's WRITE gate, named as such (Always Tabs follow-up
 * 2026-09-16): git-map went desk-independent (Always Tabs D2 — a
 * point-in-time read answers on every access mode), so its `enabled`
 * no longer means "may write". The panel still owes its Save verb, its
 * editor lock, and its Edit/View toggle label to the FRESH full-access
 * gate — the same `gitGateEnabled` the watcher stream and the write
 * route resolve — so this route is that answer, and nothing more.
 * No filesystem touch: the gate resolves from the ledger tail and the
 * live projections, exactly like git-events' connect-time check.
 */
import { json } from '@sveltejs/kit';

import { gitGateEnabled } from '$lib/server/git-probe';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const sessionId = url.searchParams.get('sessionId');
	if (sessionId === null || sessionId.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-params', message: 'sessionId is required' } },
			{ status: 400 }
		);
	}
	let enabled: boolean;
	try {
		enabled = await gitGateEnabled(sessionId);
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
	return json({ ok: true, enabled });
};
