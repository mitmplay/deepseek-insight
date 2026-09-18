/**
 * api-dsh — GET /api/dsh/session/[sessionId]/catalog (Slash Menu W1, task 1.2)
 *
 * The composer's `/` menu read path: BOTH host catalogs in one round-trip —
 * commands/list + skills/list fired in parallel (PRD §5), merged into one
 * payload. Fetched on first menu open per session, never on panel mount
 * (ADR §3.3 — commands/list may resume a cold session); the client cache
 * (slash-directory.svelte.ts) owns that discipline, this route only serves.
 *
 * Honest failure (PRD §5): EITHER leg failing fails the whole catalog — a
 * half catalog is a lie about the session's vocabulary. DshRpcError → 502
 * with the host's code; transport down → 503 (mapRpcFailure/statusFor).
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const sessionId = params.sessionId;
	try {
		const conn = getDshConnection();
		const [commands, skills] = await Promise.all([
			conn.listCommands(sessionId),
			conn.listSkills(sessionId)
		]);
		return json({ ok: true, commands, skills: skills.skills });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
