/**
 * api-dsh — GET /api/dsh/session/[sessionId]/models  (POC-3 W3, task 3.2)
 *
 * session.models → the normalized model directory for the header selector.
 * `routable` rides verbatim (a surface that blocks input reads this rather
 * than the groups — catalog membership is advisory). Garbage catalogs
 * normalize to empty lists, never an error (connection owns that truth).
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	try {
		const directory = await getDshConnection().listModels(params.sessionId);
		return json({ ok: true, ...directory });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
