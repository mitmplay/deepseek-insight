/**
 * api-dsh — GET /api/dsh/sessions · POST /api/dsh/sessions
 *
 * GET: the live session list (DsiSessionSummary rows) + the workspace
 * registry + the full preset catalog. The browser never reaches the DSH
 * Host directly (BC-1); this route is its only view of session.list,
 * workspace.list, and agentPreset.list (BC-6: wire bytes live behind
 * dsh-connection → dsh-rpc).
 *
 * POST (POC-2 W3, self-sufficiency): create a session on the host through
 * the same choke point. Body {agentPreset?} → {ok:true, sessionId, agentPreset}.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const conn = getDshConnection();
		// One round trip for the pickers: rows + the workspace registry that
		// authoritates their workspace dimension (2026-08-23 registry parity)
		// + the preset catalog the agent pills list in full (2026-08-24: the
		// pills are the New-chat selection surface, not just a session filter).
		const [sessions, workspaces, presets] = await Promise.all([
			conn.listSessions(),
			conn.listWorkspaces(),
			conn.listPresets()
		]);
		return json({
			ok: true,
			sessions: sessions.items,
			workspaces: workspaces.items,
			presets: presets.presets
		});
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};

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

	const agentPreset = (body as { agentPreset?: unknown } | null)?.agentPreset;
	if (agentPreset !== undefined && typeof agentPreset !== 'string') {
		return json(
			{ ok: false, error: { code: 'bad-preset', message: 'agentPreset must be a string' } },
			{ status: 400 }
		);
	}

	// Workspace inheritance (2026-08-23): the caller's current workspace —
	// the create lands in the same project instead of the host default.
	const cwd = (body as { cwd?: unknown } | null)?.cwd;
	if (cwd !== undefined && (typeof cwd !== 'string' || cwd.length === 0)) {
		return json(
			{ ok: false, error: { code: 'bad-cwd', message: 'cwd must be a non-empty string' } },
			{ status: 400 }
		);
	}

	try {
		const created = await getDshConnection().createSession(
			cwd === undefined ? undefined : cwd,
			agentPreset === undefined || agentPreset === '' ? undefined : agentPreset
		);
		return json({ ok: true, sessionId: created.sessionId, agentPreset: created.agentPreset ?? null });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
