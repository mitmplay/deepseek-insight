/**
 * api-skills - GET /api/skills/progress
 * Live harvest progress (2026-09-23): the engine (refresh --reload)
 * rewrites skr-progress.json after EACH source completes — parallel 3 at
 * a time — and DELETES it when enumeration ends. File absent = no run:
 * { running: false }. The shelf button polls this while its spinner is
 * up and renders {done}/{total}. The path is env-seamed (BC-10 class)
 * so tests never touch the operator's real ~/.dsi.
 */

import { json } from '@sveltejs/kit';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RequestHandler } from './$types';

/** Underscore-prefixed: SvelteKit endpoints allow only handler exports. */
export const _PROGRESS_PATH = () =>
	process.env.SHELF_PROGRESS_PATH || join(homedir(), '.dsi/resources/skr-progress.json');

export const GET: RequestHandler = async () => {
	const path = _PROGRESS_PATH();
	try {
		if (!existsSync(path))
			return json({ ok: true, running: false, done: 0, total: 0, skillDone: 0, skillTotal: 0, sources: [] });
		const p = JSON.parse(readFileSync(path, 'utf8')) as {
			running?: boolean;
			done?: number;
			total?: number;
			skillDone?: number;
			skillTotal?: number;
			sources?: Array<{ name?: string; state?: string }>;
		};
		return json({
			ok: true,
			running: p.running !== false,
			done: Number.isFinite(p.done) ? Number(p.done) : 0,
			total: Number.isFinite(p.total) ? Number(p.total) : 0,
			skillDone: Number.isFinite(p.skillDone) ? Number(p.skillDone) : 0,
			skillTotal: Number.isFinite(p.skillTotal) ? Number(p.skillTotal) : 0,
			// per-source states (pending/working/done) — the shelf chips eat
			// these; junk rows are dropped, names coerced to strings.
			sources: Array.isArray(p.sources)
				? p.sources
						.filter((s) => s && typeof s.name === 'string')
						.map((s) => ({
							name: s.name as string,
							state: s.state === 'working' || s.state === 'done' ? s.state : 'pending'
						}))
				: []
		});
	} catch {
		// a torn read mid-write must never 500 the spinner's poll
		return json({ ok: true, running: false, done: 0, total: 0, skillDone: 0, skillTotal: 0, sources: [] });
	}
};
