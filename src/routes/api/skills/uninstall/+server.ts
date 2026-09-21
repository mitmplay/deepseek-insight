/**
 * api-skills - POST /api/skills/uninstall
 * Body: { ids: string[] }. Signed-only (ADR D5): any unsigned refusal maps to 409.
 */

import { json } from '@sveltejs/kit';

import { getEngine } from '$lib/server/skills/engine';
import { EngineFailedError, EngineMissingError } from '$lib/server/skills/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let ids: unknown;
	try {
		ids = (await request.json()).ids;
	} catch {
		return json({ ok: false, error: 'malformed JSON body' }, { status: 400 });
	}
	if (!Array.isArray(ids) || ids.length === 0 || !ids.every((t) => typeof t === 'string' && t.length > 0)) {
		return json({ ok: false, error: 'ids must be a non-empty array of strings' }, { status: 400 });
	}
	try {
		const results = await getEngine().apply('uninstall', ids as string[]);
		const unsigned = results.some((r) => !r.ok && /unsigned/.test(r.error ?? ''));
		return json({ ok: results.every((r) => r.ok), results }, { status: unsigned ? 409 : 200 });
	} catch (err) {
		const status = err instanceof EngineMissingError || err instanceof EngineFailedError ? 503 : 500;
		return json({ ok: false, error: String((err as Error).message) }, { status });
	}
};