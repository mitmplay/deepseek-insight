/**
 * api-dsh — POST /api/dsh/workspaces/[workspaceId]/delete
 *
 * Chip Menu ADR D3: the workspace chip's Delete action (confirmed
 * client-side, ADR D2). No body → host workspace/delete →
 * {ok:true, workspaceId}. The host removes ONLY the registry row —
 * sessions survive and turn ghost (ADR D2's honest cost copy states
 * this in the UI). Refusals map through mapRpcFailure (502).
 * The browser never reaches the DSH Host directly (BC-1); wire bytes
 * live behind dsh-connection (BC-6).
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
	const workspaceId = params.workspaceId;
	if (typeof workspaceId !== 'string' || workspaceId.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-workspace-id', message: 'workspaceId must be a non-empty string' } },
			{ status: 400 }
		);
	}

	try {
		const result = await getDshConnection().deleteWorkspace(workspaceId);
		return json({ ok: true, workspaceId: result.workspaceId });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
