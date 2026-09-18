/**
 * api-dsh — GET /api/dsh/session/[sessionId]/attachment?attachmentId=…
 *
 * The echo's authorized read (task 3.2, ADR D7): proxies session.attachment
 * — the ledger stores refs; bytes are fetched through this route only when
 * rendered, session-authorized by the host (BC-A5: the echo renders from
 * the ledger, never from the browser draft).
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const sessionId = params.sessionId;
	const attachmentId = url.searchParams.get('attachmentId');
	if (attachmentId === null || attachmentId.length === 0) {
		return json(
			{ ok: false, error: { code: 'missing-attachment-id', message: 'attachmentId query parameter is required' } },
			{ status: 400 }
		);
	}

	try {
		const value = await getDshConnection().readAttachment(sessionId, attachmentId);
		return json({ ok: true, attachment: value.attachment, data: value.data });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
