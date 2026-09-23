/**
 * api-skills - POST /api/skills/reload/cancel
 * The bored-operator verb (Reload Rememberer, 2026-09-23): kills the
 * in-flight engine child and clears the progress sidecar. The snapshot
 * cache is only written at the END of a successful refresh, so the OLD
 * snapshot survives untouched — cancel loses nothing but the wait.
 */

import { json } from '@sveltejs/kit';
import { rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cancelRefresh } from '$lib/server/skills/engine';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	const killed = cancelRefresh();
	if (killed) {
		try {
			rmSync(process.env.SHELF_PROGRESS_PATH || join(homedir(), '.dsi/resources/skr-progress.json'), { force: true });
		} catch { /* best-effort */ }
	}
	// getEngine().cancelRefresh is exported for parity; the module-level
	// kill handle is the same single-flight child.
	return json({ ok: true, cancelled: killed });
};