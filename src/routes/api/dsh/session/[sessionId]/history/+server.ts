/**
 * api-dsh — GET /api/dsh/session/[sessionId]/history?beforeSeq=N
 *
 * POC-2 W3 (load-older paging): the ledger page that ENDS at N−1 (live-probed
 * semantics, PRD §1.2) — mapped through the same dsh-events rules as the cold
 * load so prepended entries merge identically. The ledger is the truth (BC-4):
 * the ring buffer is never consulted here.
 *
 * Response: {ok, entries, lastSeq, hasMore}. 400 when beforeSeq is absent or
 * not a finite number (a page anchor is required — there is no tail default
 * here; the cold load already serves the tail).
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';
import { eventsToEntries, historyToEvents } from '$lib/services/conversation/dsh-events';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const sessionId = params.sessionId;
	const beforeRaw = url.searchParams.get('beforeSeq');
	const beforeSeq = beforeRaw !== null ? Number(beforeRaw) : NaN;
	if (beforeRaw === null || !Number.isFinite(beforeSeq)) {
		return json(
			{ ok: false, error: { code: 'bad-beforeSeq', message: 'beforeSeq must be a finite number' } },
			{ status: 400 }
		);
	}

	try {
		const page = await getDshConnection().historyPage(sessionId, beforeSeq);
		const events = historyToEvents(page.events);
		const entries = eventsToEntries(events);
		const lastSeq = events.at(-1)?.seq ?? -1;
		return json({ ok: true, entries, lastSeq, hasMore: page.hasMore === true });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
