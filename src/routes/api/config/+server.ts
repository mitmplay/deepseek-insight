/**
 * GET /api/config
 *
 * Returns DSI's operator-tunable browser config, read from
 * ~/.dsi/settings.yaml (OCI /api/config pattern, ported 2026-08-25).
 * The browser store (app-config.svelte.ts) applies this on load; every
 * section falls back to defaults on missing/invalid values. The server-only
 * section (server.ringCapacity) is intentionally absent — dsh-connection
 * reads it directly server-side.
 */

import { json } from '@sveltejs/kit';
import {
	readA2aConfig,
	readChatConfig,
	readConversationConfig,
	readHomeConfig,
	readPanelConfig,
	readPromptsConfig,
	readSidebarConfig,
	readSettingsHomes
} from '$lib/server/insight-config';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	return json({
		ok: true,
		chat: readChatConfig(),
		conversation: readConversationConfig(),
		home: readHomeConfig(),
		a2a: readA2aConfig(),
		panel: readPanelConfig(),
		sidebar: readSidebarConfig(),
		// Only the browser-relevant half of the prompts section — the file
		// path (dbPath) is server-side and never crosses the wire.
		prompts: { tags: readPromptsConfig().tags },
		// The Settings Tree (ADR 2026-09-18 D2): the verbatim settings home
		// roots, so /dsisettings · /dshsettings mint explorers with the
		// server's own homedir truth. Read-only facts, never tuned.
		settingsHomes: readSettingsHomes()
	});
};
