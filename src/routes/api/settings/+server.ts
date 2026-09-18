/**
 * GET/PUT /api/settings?target=dsi|dsh — raw-document access for the
 * settings editor panel (The Settings Panel ADR, 2026-09-07, D5/D7).
 *
 * GET returns the file's raw text plus an honest `missing` marker and,
 * for the dsi target only, `defaultText` — the section defaults
 * serialized as YAML, so the editor shows something true about a file
 * that does not exist yet (the dsh document is DSH-owned; DSI never
 * fabricates harness defaults). The full document crosses this seam for
 * the single local operator, `dsh.authToken` included (D7 — a buffer
 * that is not the file would corrupt it on save).
 *
 * PUT accepts `{ text }` (the whole edited document). The server
 * YAML-parses first: a parse failure is a 400 carrying the parser's line
 * and column, and NOTHING is written (D5). Unknown target is a 400.
 *
 * Spec: dev/specs/2026-09-07 - DSI Settings Panel (PRD Module Map
 *      "settings-api"; Tasks 2.1/2.1-T).
 */

import { json } from '@sveltejs/kit';
import { stringify } from 'yaml';

import {
	DEFAULT_A2A_CONFIG,
	DEFAULT_CHAT_CONFIG,
	DEFAULT_CONVERSATION_CONFIG,
	DEFAULT_DSH_PRESET_ENGLISH,
	DEFAULT_HOME_CONFIG,
	DEFAULT_PANEL_CONFIG,
	DEFAULT_PROMPTS_CONFIG,
	DEFAULT_SERVER_CONFIG,
	DEFAULT_SIDEBAR_CONFIG
} from '$lib/server/insight-config';
import {
	SettingsParseError,
	readSettingsDocument,
	saveSettingsDocument,
	type SettingsTarget
} from '$lib/server/settings-document';

import type { RequestHandler } from './$types';

/** The dsi default document — one home per fact: the same DEFAULT_*
 *  constants the section readers fall back to, serialized as YAML. */
function defaultDsiDocument(): string {
	return stringify({
		chat: DEFAULT_CHAT_CONFIG,
		conversation: DEFAULT_CONVERSATION_CONFIG,
		home: DEFAULT_HOME_CONFIG,
		a2a: DEFAULT_A2A_CONFIG,
		panel: DEFAULT_PANEL_CONFIG,
		sidebar: DEFAULT_SIDEBAR_CONFIG,
		prompts: DEFAULT_PROMPTS_CONFIG,
		server: DEFAULT_SERVER_CONFIG,
		// The Settings Tree ADR 2026-09-18 D1: no `workspace` section — the
		// layout knob is deleted, the explorer layout is the only layout.
		// authToken is server-only and never seeded (D7 posture: the
		// editor shows the real file; a default document shows no secret)
		dsh: { presetEnglish: DEFAULT_DSH_PRESET_ENGLISH.presetEnglish }
	});
}

/** Validate the target param; null + a served 400 when absent/unknown. */
function parseTarget(url: URL): { target: SettingsTarget } | { error: ReturnType<typeof json> } {
	const raw = url.searchParams.get('target');
	if (raw === 'dsi' || raw === 'dsh') return { target: raw };
	return {
		error: json({ ok: false, error: 'target must be dsi or dsh' }, { status: 400 })
	};
}

export const GET: RequestHandler = async ({ url }) => {
	const parsed = parseTarget(url);
	if ('error' in parsed) return parsed.error;
	const { text, missing } = readSettingsDocument(parsed.target);
	return json({
		ok: true,
		target: parsed.target,
		text,
		missing,
		defaultText: parsed.target === 'dsi' && missing ? defaultDsiDocument() : ''
	});
};

export const PUT: RequestHandler = async ({ url, request }) => {
	const parsed = parseTarget(url);
	if ('error' in parsed) return parsed.error;
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'body must be JSON with a text field' }, { status: 400 });
	}
	if (
		typeof body !== 'object' ||
		body === null ||
		typeof (body as { text?: unknown }).text !== 'string'
	) {
		return json({ ok: false, error: 'body must be { text: string }' }, { status: 400 });
	}
	try {
		saveSettingsDocument(parsed.target, (body as { text: string }).text);
	} catch (err) {
		if (err instanceof SettingsParseError) {
			return json(
				{ ok: false, error: err.message, line: err.line, column: err.column },
				{ status: 400 }
			);
		}
		throw err;
	}
	return json({ ok: true, target: parsed.target });
};
