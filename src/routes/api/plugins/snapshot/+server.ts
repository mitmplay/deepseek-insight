/**
 * api-plugins — GET /api/plugins/snapshot
 * Snapshot-first (ADR "The Plugin Rack" D3): absent cache triggers build;
 * present cache is used as-is. Mirrors /api/skills/snapshot.
 */
import { json } from '@sveltejs/kit';

import { getRackEngine } from '$lib/server/plugins/engine';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const engine = getRackEngine();
		const { present } = await engine.snapshotStatus();
		const { snapshot, reused } = await engine.refresh(!present);
		return json({ ok: true, reused, snapshot });
	} catch (err) {
		return json({ ok: false, error: String((err as Error).message) }, { status: 503 });
	}
};
