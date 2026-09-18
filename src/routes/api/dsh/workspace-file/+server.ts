/**
 * api-dsh — GET /api/dsh/workspace-file?sessionId=…&path=…&offset=…&limit=…
 *
 * One page of one real workspace file (Workspace Explorer W2, 2026-09-10
 * ADR D2): the ONE module that touches host file bytes. The browser never
 * reaches the DSH Host directly (BC-1); the read rides dsh-rpc →
 * workspaceFiles/read, whose host side confines the path to the session's
 * workspace root by containment. Every host refusal maps to an HTTP status
 * so a file panel never renders blank (Karpathy Layer 2 failure condition):
 *
 *   workspace-file/not-found        → 404
 *   workspace-file/outside-workspace → 403
 *   workspace-file/too-large        → 413
 *   workspace-file/not-text
 *   workspace-file/not-regular-file → 415
 *   any other DshRpcError           → 502 (host answered, we relay)
 *   transport failure               → 503 host-unreachable
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { DshRpcError, mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

/** Refusal code → HTTP status for the panel's failure line. */
const REFUSAL_STATUS: Record<string, number> = {
	'workspace-file/not-found': 404,
	'workspace-file/outside-workspace': 403,
	'workspace-file/too-large': 413,
	'workspace-file/not-text': 415,
	'workspace-file/not-regular-file': 415
};

/** Positive-integer query param: undefined when absent, 'bad' when malformed. */
function pageParam(raw: string | null): number | 'bad' | undefined {
	if (raw === null) return undefined;
	if (!/^\d+$/.test(raw) || Number(raw) < 1) return 'bad';
	return Number(raw);
}

export const GET: RequestHandler = async ({ url }) => {
	const sessionId = url.searchParams.get('sessionId');
	if (sessionId === null || sessionId.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-session', message: 'sessionId is required' } },
			{ status: 400 }
		);
	}
	const path = url.searchParams.get('path');
	if (path === null || path.length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-path', message: 'path is required' } },
			{ status: 400 }
		);
	}
	const offset = pageParam(url.searchParams.get('offset'));
	if (offset === 'bad') {
		return json(
			{ ok: false, error: { code: 'bad-offset', message: 'offset must be a positive integer' } },
			{ status: 400 }
		);
	}
	const limit = pageParam(url.searchParams.get('limit'));
	if (limit === 'bad') {
		return json(
			{ ok: false, error: { code: 'bad-limit', message: 'limit must be a positive integer' } },
			{ status: 400 }
		);
	}

	try {
		// Address the workspace RPC at the session's ROOT owner — sub-agent
		// session ids are refused by the host (2026-09-10 fix).
		const conn = getDshConnection();
		const owner = await conn.workspaceOwnerSessionId(sessionId);
		const file = await conn.readWorkspaceFile(
			owner,
			path,
			offset === undefined && limit === undefined ? undefined : { offset, limit }
		);
		return json({ ok: true, file });
	} catch (err) {
		if (err instanceof DshRpcError) {
			const mapped = REFUSAL_STATUS[err.code];
			if (mapped !== undefined) return json(mapRpcFailure(err), { status: mapped });
		}
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
