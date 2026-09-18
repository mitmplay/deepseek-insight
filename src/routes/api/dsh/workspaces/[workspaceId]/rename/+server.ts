/**
 * api-dsh — POST /api/dsh/workspaces/[workspaceId]/rename
 *
 * Chip Menu ADR D3: the workspace chip's Rename action. Body {title} →
 * host workspace/rename → {ok:true, workspace}. Refusals map through
 * mapRpcFailure (workspace/not-found, workspace/name-conflict → 502).
 * The browser never reaches the DSH Host directly (BC-1); wire bytes
 * live behind dsh-connection (BC-6).
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	const workspaceId = params.workspaceId;
	if (typeof workspaceId !== 'string' || workspaceId.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-workspace-id', message: 'workspaceId must be a non-empty string' } },
			{ status: 400 }
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(
			{ ok: false, error: { code: 'bad-json', message: 'request body is not valid JSON' } },
			{ status: 400 }
		);
	}

	// Trimmed-empty refuses here (ADR D2): the host's own rename contract
	// trims and would reject, but the route never spends the wire call.
	const title = (body as { title?: unknown } | null)?.title;
	if (typeof title !== 'string' || title.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-title', message: 'title must be a non-empty string' } },
			{ status: 400 }
		);
	}

	try {
		const result = await getDshConnection().renameWorkspace(workspaceId, title.trim());
		return json({ ok: true, workspace: result.workspace });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
