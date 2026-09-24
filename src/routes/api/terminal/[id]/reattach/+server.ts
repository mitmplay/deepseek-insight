/**
 * /api/terminal/[id]/reattach — token re-mint for a page reload (The
 * Surviving Shell, ADR 2026-09-24 D2): a thin POST over the registry's
 * reattach — the asking tab gets a fresh token and the session's whole-
 * stream byte tail; the old token dies (many watchers, one writer).
 */
import { json } from '@sveltejs/kit';

import { terminalRegistry, TerminalRegistryRefusal } from '$lib/server/terminal/registry.js';

export const POST = (ctx: { params: { id: string } }): Response => {
	try {
		const { token, fromByte } = terminalRegistry.reattach(ctx.params.id);
		return json({ token, fromByte });
	} catch (err) {
		if (err instanceof TerminalRegistryRefusal) {
			return json({ error: err.code }, { status: err.code === 'NO_SESSION' ? 404 : 403 });
		}
		throw err;
	}
};
