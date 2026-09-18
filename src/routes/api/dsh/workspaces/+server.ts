/**
 * api-dsh — POST /api/dsh/workspaces
 *
 * Workspace registry adoption (2026-08-23, DSH "Add workspace" parity):
 * the sidebar header button's carrier. Body {path} → host workspace.create
 * → {ok:true, workspace, created}. The browser never reaches the DSH Host
 * directly (BC-1); wire bytes live behind dsh-connection (BC-6).
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

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

	const path = (body as { path?: unknown } | null)?.path;
	if (typeof path !== 'string' || path.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-path', message: 'path must be a non-empty string' } },
			{ status: 400 }
		);
	}

	try {
		const result = await getDshConnection().createWorkspace(path);
		return json({ ok: true, workspace: result.workspace, created: result.created });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
