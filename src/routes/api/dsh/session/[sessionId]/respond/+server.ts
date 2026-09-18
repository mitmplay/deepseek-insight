/**
 * api-dsh — POST /api/dsh/session/[sessionId]/respond  (POC-3 W1)
 *
 * Body {rpcId, payload} → the client-response carrier via dsh-connection.
 *
 * BC-B: a REFUSED answer is a successful exchange — the receipt maps to
 * HTTP 200 {ok:true, accepted:false, reason} so the card settles
 * "answered elsewhere" (not-pending: another UI won the first-claimant
 * race) or surfaces a honest validation refusal (bad-response). Only
 * transport failures are errors (503 — the card stays answerable).
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

	const { rpcId, payload } = (body ?? {}) as { rpcId?: unknown; payload?: unknown };
	if (typeof rpcId !== 'string' || rpcId.length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-rpcId', message: 'rpcId must be a non-empty string' } },
			{ status: 400 }
		);
	}
	if (payload === undefined || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
		return json(
			{ ok: false, error: { code: 'bad-payload', message: 'payload must be an object' } },
			{ status: 400 }
		);
	}

	try {
		const receipt = await getDshConnection().respond(rpcId, { sessionId, ...payload });
		// Receipt ≠ error (BC-B): both arms are 200. The client settles on this.
		return json({ ok: true, accepted: receipt.accepted, ...(receipt.accepted ? {} : { reason: receipt.reason }) });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
