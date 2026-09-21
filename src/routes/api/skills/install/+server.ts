/**
 * api-skills - POST /api/skills/install
 * Body: { targets: string[] } - explicit shelf numbers or ids.
 * Returns per-target results; 400 on malformed body, 503 on engine failure.
 */

import { json } from '@sveltejs/kit';

import { getEngine } from '$lib/server/skills/engine';
import { EngineFailedError, EngineMissingError } from '$lib/server/skills/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let targets: unknown;
	try {
		targets = (await request.json()).targets;
	} catch {
		return json({ ok: false, error: 'malformed JSON body' }, { status: 400 });
	}
	if (!Array.isArray(targets) || targets.length === 0 || !targets.every((t) => typeof t === 'string' && t.length > 0)) {
		return json({ ok: false, error: 'targets must be a non-empty array of strings' }, { status: 400 });
	}
	try {
		const results = await getEngine().apply('install', targets as string[]);
		return json({ ok: results.every((r) => r.ok), results });
	} catch (err) {
		const status = err instanceof EngineMissingError || err instanceof EngineFailedError ? 503 : 500;
		return json({ ok: false, error: String((err as Error).message) }, { status });
	}
};