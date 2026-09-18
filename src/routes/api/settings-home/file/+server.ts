/**
 * api-settings-home — GET /api/settings-home/file?home=dsi|dsh&path=<rel>
 * Read one TEXT file of a settings home (the explorer file tab).
 *
 * The Settings Tree ADR (2026-09-18, D2): the DSI-LOCAL data plane for a
 * session-less settings explorer. Containment refusals map to 400;
 * missing paths to 404; everything else is a 500 with the reason.
 */
import { json } from '@sveltejs/kit';

import {
	SettingsHomeRefusal,
	isSettingsHome
} from '$lib/server/settings-home.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const home = url.searchParams.get('home');
	const rel = url.searchParams.get('path');
	if (!isSettingsHome(home)) {
		return json({ ok: false, error: { code: 'bad-home', message: 'home must be dsi or dsh' } }, { status: 400 });
	}
	if (rel === null || rel.length === 0) {
		return json({ ok: false, error: { code: 'bad-path', message: 'path is required' } }, { status: 400 });
	}
	try {
		const { readSettingsHomeFile } = await import('$lib/server/settings-home.js');
		const file = await readSettingsHomeFile(home, rel);
		return json({ ok: true, file });
	} catch (err) {
		if (err instanceof SettingsHomeRefusal) {
			return json({ ok: false, error: { code: err.code, message: err.message } }, { status: 400 });
		}
		const code = (err as { code?: string }).code ?? 'io-error';
		if (code === 'ENOENT') {
			return json({ ok: false, error: { code: 'not-found', message: 'no such file' } }, { status: 404 });
		}
		return json({ ok: false, error: { code: 'io-error', message: String((err as Error).message ?? err) } }, { status: 500 });
	}
};
