/**
 * api-dsh — GET /api/dsh/jobs?sessionId=… · POST /api/dsh/jobs
 *
 * Jobs (ADR-0026 D2/D3, Job Badge Wave 1): the browser's only view of the
 * host's per-session job roster (BC-1/BC-6 — the browser never reaches the
 * DSH Host directly).
 *
 * GET: one job.list snapshot for sessionId — the whole visible set (the
 * session's own jobs plus every unowned job). Live updates ride the mux push
 * path (relay.dispatchJobRoster) or a client refetch; the ledger is NOT
 * authority for live state (ADR fact 10).
 *
 * POST: job.kill passthrough — body {sessionId, jobId} → {outcome}.
 * The session fence stays server-side; a refusal surfaces verbatim.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const sessionId = url.searchParams.get('sessionId');
	if (!sessionId) {
		return json(
			{ ok: false, error: { code: 'bad-session', message: 'sessionId query parameter is required' } },
			{ status: 400 }
		);
	}
	try {
		// The Roster Mirror (ADR 2026-10-17 D1/D3): the poll tick is the
		// server-side watch heartbeat; the answer is the cached newest
		// job/list frame, or an honest pending — never a unary host call
		// (the host refuses unary on its stream-only method; RCA 2026-10-17).
		const relay = getDshConnection().relay;
		relay.touchJobRoster(sessionId);
		const frame = relay.jobRosterSnapshot(sessionId);
		return json({
			ok: true,
			sessionId,
			jobs: frame.jobs,
			...(frame.pending ? { pending: true } : {})
		});
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(
			{ ok: false, error: { code: 'bad-json', message: 'request body is not valid JSON' } },
			{ status: 400 }
		);
	}
	const { sessionId, jobId } = (body ?? {}) as { sessionId?: unknown; jobId?: unknown };
	if (typeof sessionId !== 'string' || sessionId.length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-session', message: 'sessionId is required' } },
			{ status: 400 }
		);
	}
	if (typeof jobId !== 'string' || jobId.length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-job', message: 'jobId is required' } },
			{ status: 400 }
		);
	}
	try {
		const result = await getDshConnection().relay.jobKill(sessionId, jobId);
		return json({ ok: true, outcome: result.outcome });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
