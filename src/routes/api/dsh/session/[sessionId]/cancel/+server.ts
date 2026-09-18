/**
 * api-dsh — POST /api/dsh/session/[sessionId]/cancel
 *
 * session.cancel → {accepted:true}. One POST away from stopping a running
 * turn; error mapping identical to the other routes.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
	const sessionId = params.sessionId;
	try {
		const receipt = await getDshConnection().cancel(sessionId);
		return json({ ok: true, accepted: receipt.accepted === true });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
