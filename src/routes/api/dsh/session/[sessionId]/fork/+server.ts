/**
 * api-dsh — POST /api/dsh/session/[sessionId]/fork  (The Fork Button ADR, 2026-09-01)
 *
 * Body {atSeq?} → session.fork. An absent atSeq is the normal path: the host
 * cuts at the source's last completed turn. A present atSeq anchors to the
 * first turn/end at or after it; an anchor inside an open turn is a host
 * refusal (`session/fork-unavailable` → 502 here), never a silent clip.
 * Success → {ok:true, sessionId} (the fork child). Error mapping identical
 * to the sibling routes (mapRpcFailure/statusFor): host refusals surface as
 * 502 with the host's code, transport failure as 503 host-unreachable.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	const sessionId = params.sessionId;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(
			{ ok: false, error: { code: 'bad-json', message: 'request body is not valid JSON' } },
			{ status: 400 }
		);
	}

	const atSeq = (body as { atSeq?: unknown } | null)?.atSeq;
	if (
		atSeq !== undefined &&
		(typeof atSeq !== 'number' || !Number.isInteger(atSeq) || atSeq < 0)
	) {
		return json(
			{
				ok: false,
				error: {
					code: 'bad-atSeq',
					message: 'atSeq must be a non-negative integer when present'
				}
			},
			{ status: 400 }
		);
	}

	try {
		const forked = await getDshConnection().forkSession(
			sessionId,
			atSeq === undefined ? undefined : (atSeq as number)
		);
		return json({ ok: true, sessionId: forked.sessionId });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
