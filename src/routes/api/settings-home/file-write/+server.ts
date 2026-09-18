/**
 * api-settings-home — POST /api/settings-home/file-write
 * { home, path, content } — save one TEXT file of a settings home.
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

export const POST: RequestHandler = async ({ request }) => {
	let body: { home?: unknown; path?: unknown; content?: unknown };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return json({ ok: false, error: { code: 'bad-json', message: 'body must be JSON' } }, { status: 400 });
	}
	if (!isSettingsHome(body.home)) {
		return json({ ok: false, error: { code: 'bad-home', message: 'home must be dsi or dsh' } }, { status: 400 });
	}
	if (typeof body.path !== 'string' || body.path.length === 0) {
		return json({ ok: false, error: { code: 'bad-path', message: 'path is required' } }, { status: 400 });
	}
	try {
		const { writeSettingsHomeFile } = await import('$lib/server/settings-home.js');
		await writeSettingsHomeFile(body.home, body.path, body.content as string);
		return json({ ok: true });
	} catch (err) {
		if (err instanceof SettingsHomeRefusal) {
			return json({ ok: false, error: { code: err.code, message: err.message } }, { status: 400 });
		}
		return json({ ok: false, error: { code: 'io-error', message: String((err as Error).message ?? err) } }, { status: 500 });
	}
};
