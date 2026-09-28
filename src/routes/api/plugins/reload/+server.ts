/**
 * api-plugins — POST /api/plugins/reload
 * Forces a snapshot rebuild (--reload, ADR D3): the panel's first fetch then
 * carries the fresh numbering and the manifest-reconciled installed flags.
 */
import { json } from '@sveltejs/kit';

import { getRackEngine } from '$lib/server/plugins/engine';
import { fetchRackStars } from '$lib/server/plugins/stars';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	try {
		const { snapshot, errors } = await getRackEngine().refresh(true);
		const stars = await fetchRackStars(snapshot.plugins);
		return json({ ok: true, snapshot, stars, ...(errors ? { errors } : {}) });
	} catch (err) {
		return json({ ok: false, error: String((err as Error).message) }, { status: 503 });
	}
};
