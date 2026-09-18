/**
 * api-dsh — POST /api/dsh/session/[sessionId]/rename  (POC-3 W3, task 3.1)
 *
 * Body {title} → session.rename. The host normalizes the title and returns
 * {title, seq} — the normalized ACCEPTED title pins the projection cell
 * immediately (no push-frame wait). A title that normalizes to empty is a
 * host RPC error (`title-invalid` → 502 here); transport failure → 503.
 * Error mapping identical to the sibling routes (mapRpcFailure/statusFor).
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

	const title = (body as { title?: unknown } | null)?.title;
	if (typeof title !== 'string' || title.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'empty-title', message: 'title must be a non-empty string' } },
			{ status: 400 }
		);
	}

	try {
		const renamed = await getDshConnection().renameSession(sessionId, title);
		return json({ ok: true, title: renamed.title, seq: renamed.seq });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
