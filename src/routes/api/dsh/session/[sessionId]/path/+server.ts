/**
 * api-dsh — GET /api/dsh/session/[sessionId]/path
 *
 * The Session Full Path (ADR D2, 2026-09-14): the ONLY seam between the
 * header button and the disk. Reads the operator's sessions root
 * (readDshSessionsRootConfig) and scans it for a directory named
 * `session-<id>` (resolveSessionPath — a directory-name scan, never a
 * re-implementation of DSH's projectKey encoding).
 *
 * 200 { ok, path } — the absolute session directory exists on disk.
 * 404 — no directory, missing root, or any read error: a guessed path
 * never ships (the Delete Gap rule). The client hides the button on 404
 * (ADR D4 — no visible-disabled guess state).
 *
 * No DSH rpc here: the answer is local disk truth, so remote-host DSI
 * honestly 404s (the documented ADR give-up).
 */

import { json } from '@sveltejs/kit';

import { readDshSessionsRootConfig } from '$lib/server/insight-config.js';
import { resolveSessionPath } from '$lib/server/session-path.js';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const { sessionsRoot } = readDshSessionsRootConfig();
	const path = await resolveSessionPath(sessionsRoot, params.sessionId);
	if (path === null) {
		return json(
			{
				ok: false,
				error: {
					code: 'session-path-not-found',
					message: `no session directory for ${params.sessionId} under ${sessionsRoot}`
				}
			},
			{ status: 404 }
		);
	}
	return json({ ok: true, path });
};
