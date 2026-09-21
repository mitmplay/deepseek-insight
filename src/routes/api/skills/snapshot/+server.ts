/**
 * api-skills - GET /api/skills/snapshot
 * Snapshot-first (ADR D3): absent cache triggers build; present cache is used as-is.
 * Response: { ok, snapshot, uninstallable } - uninstallable from signed+installed (D5).
 */

import { json } from '@sveltejs/kit';

import { getEngine } from '$lib/server/skills/engine';
import { uninstallableIds } from '$lib/server/skills/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const engine = getEngine();
		const { present } = await engine.snapshotStatus();
		const { snapshot, reused } = await engine.refresh(!present);
		return json({ ok: true, reused, snapshot, uninstallable: uninstallableIds(snapshot) });
	} catch (err) {
		return json({ ok: false, error: String((err as Error).message) }, { status: 503 });
	}
};