/**
 * api-skills - POST /api/skills/reload
 * Forced rebuild (ADR D3 --reload): re-reads the SKR, re-diffs, regenerates.
 */

import { json } from '@sveltejs/kit';

import { getEngine } from '$lib/server/skills/engine';
import { uninstallableIds } from '$lib/server/skills/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	try {
		const { snapshot } = await getEngine().refresh(true);
		return json({ ok: true, snapshot, uninstallable: uninstallableIds(snapshot) });
	} catch (err) {
		return json({ ok: false, error: String((err as Error).message) }, { status: 503 });
	}
};