/**
 * /api/terminal/[id]/output — the retained tail as JSON (Wave 5 fix).
 * The watcher path (no token, ADR D7): offset-based reads with lossy +
 * spillPath, the same facts the SSE stream carries, as a pull.
 */
import { json } from '@sveltejs/kit';

import { terminalRegistry, TerminalRegistryRefusal } from '$lib/server/terminal/registry.js';

export const GET = (ctx: { params: { id: string }; url: URL }): Response => {
	try {
		const fromByteRaw = Number(ctx.url.searchParams.get('fromByte') ?? '0');
		const fromByte = Number.isFinite(fromByteRaw) && fromByteRaw >= 0 ? fromByteRaw : 0;
		return json(terminalRegistry.readFrom(ctx.params.id, fromByte));
	} catch (err) {
		if (err instanceof TerminalRegistryRefusal) return json({ error: err.code }, { status: err.code === 'NO_SESSION' ? 404 : 403 });
		throw err;
	}
};
