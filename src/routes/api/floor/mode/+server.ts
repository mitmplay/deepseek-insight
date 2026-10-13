/**
 * GET /api/floor/mode — which floor is this? (dev gate for the RestartButton)
 *
 * The launcher stamps DSI_DEV=1 (+ DSI_DEV_MODE) into the server env at
 * launch (bin/lib/dev-mode.mjs); the Restart Verb (ADR 2026-10-12) only
 * makes sense on such a floor, so the button asks this route once on
 * mount and stays hidden on build floors. Read-only, no auth surface:
 * it reveals nothing but the floor's own mode.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const dev = process.env.DSI_DEV === '1';
	const mode = dev ? (process.env.DSI_DEV_MODE ?? 'dev') : 'build';
	return json({ dev, mode });
};
