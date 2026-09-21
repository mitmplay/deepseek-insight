/**
 * api-skills - GET /api/skills/voice (The Shelf Voice ADR D5).
 * The merged voice map for shelf-installed skills; the slash menu
 * overlays it onto the host's English wire rows at render.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { json } from '@sveltejs/kit';

import { buildVoiceMap } from '$lib/server/skills/voice';
import type { RequestHandler } from './$types';

function skillsDirFromEnv(): string {
	return process.env.SHELF_SKILLS_DIR || join(homedir(), '.agents/skills');
}

export const GET: RequestHandler = async () => {
	try {
		return json({ ok: true, voice: buildVoiceMap(skillsDirFromEnv()) });
	} catch (err) {
		return json({ ok: false, error: String((err as Error).message) }, { status: 503 });
	}
};
