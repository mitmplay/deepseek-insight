/**
 * api-dsh — GET /api/dsh/workspace-tree?sessionId=…&path=…
 *
 * One directory level inside the session's workspace (Workspace Explorer
 * bugfix 2026-09-09): the LIVE tree lists through workspaceFiles/list —
 * session-authorized and workspace-confined — because the picker's
 * directoryPicker/list is native-only on real hosts (the live refusal
 * this route replaces: "the composed picker serves \"native\""). path is
 * workspace-relative; '' lists the root itself. Refusal mapping follows
 * the workspace-file route: not-found → 404, outside-workspace → 403,
 * not-directory → 415, other DshRpcError → 502, transport → 503.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { DshRpcError, mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

/** Refusal code → HTTP status for the tree's failure row. */
const REFUSAL_STATUS: Record<string, number> = {
	'workspace-file/not-found': 404,
	'workspace-file/outside-workspace': 403,
	'workspace-file/not-directory': 415
};

export const GET: RequestHandler = async ({ url }) => {
	const sessionId = url.searchParams.get('sessionId');
	if (sessionId === null || sessionId.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-session', message: 'sessionId is required' } },
			{ status: 400 }
		);
	}
	// path is workspace-relative and OPTIONAL — '' (or absent) lists the
	// workspace root itself; ../ escapes are the host's containment refusal.
	const path = url.searchParams.get('path') ?? '';

	try {
		// Address the workspace RPC at the session's ROOT owner — sub-agent
		// session ids are refused by the host (2026-09-10 fix).
		const conn = getDshConnection();
		const owner = await conn.workspaceOwnerSessionId(sessionId);
		const listing = await conn.listWorkspaceDirectory(owner, path);
		return json({ ok: true, listing });
	} catch (err) {
		if (err instanceof DshRpcError) {
			const mapped = REFUSAL_STATUS[err.code];
			if (mapped !== undefined) return json(mapRpcFailure(err), { status: mapped });
		}
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
