/**
 * skill-voice (The Shelf Voice ADR D5/D7) - the client overlay seat.
 * Fetches /api/skills/voice ONCE and re-labels skill rows at render:
 * shelf-installed skills via their .dsi-voice sidecar (served by the
 * route), homegrown dsi-* skills via compile-time paraglide keys
 * (skillsVoiceDsi*) - the operator's locale decides, English falls back.
 * Communication pattern: shared rune store + fetch, per the PRD Module
 * Communication Map; SlashMenu consumes the helpers, never the route.
 */

import * as m from '$lib/paraglide/messages';
import { currentLocale } from '$lib/services/locale/locale-state.svelte';

export interface VoiceEntry {
	name: string;
	description: string;
	whenToUse: string;
}

type VoiceMap = Record<string, Record<string, VoiceEntry>>;

/** Homegrown skill id -> paraglide message key (D7: compile-time voice).
 *  Guarded by tests/unit/homegrown-voice-keys.test.ts against the
 *  compiled messages index. */
export const HOMEGROWN_VOICE_KEYS: Record<string, string> = {
	'dsh-jump-prepare-fix': 'skillsVoiceDshJumpPrepareFix',
	'dsi-adr': 'skillsVoiceDsiAdr',
	'dsi-i18n-migrate': 'skillsVoiceDsiI18nMigrate',
	'dsi-ov-setup': 'skillsVoiceDsiOvSetup',
	'dsi-release': 'skillsVoiceDsiRelease',
	'dsi-spcheck': 'skillsVoiceDsiSpcheck',
	'dsi-spec': 'skillsVoiceDsiSpec',
	'dsi-sync': 'skillsVoiceDsiSync',
	'dsi-task': 'skillsVoiceDsiTask'
};

let map = $state<VoiceMap>({});
let fetched = false;

export async function ensureVoiceMap(): Promise<void> {
	if (fetched) return;
	fetched = true;
	try {
		const res = await fetch('/api/skills/voice');
		const body = await res.json();
		if (body.ok) map = (body.voice ?? {}) as VoiceMap;
	} catch {
		// offline / server hiccup: the overlay stays empty (English rows)
	}
}

/** Localized words for one skill id, or null when only the wire row exists.
 *  Resolution: active locale sidecar -> en sidecar -> homegrown paraglide
 *  key -> null. Reads currentLocale() INSIDE so callers' $derived track it.
 */
export function voiceFor(id: string): VoiceEntry | null {
	const locale = currentLocale();
	const sidecar = map?.[id]?.[locale] ?? map?.[id]?.en ?? null;
	if (sidecar) return sidecar;
	// Homegrown voice (D7): the WIRE row is already English, so the overlay
	// only speaks when the operator's locale is NOT en - calling the
	// compiled message function resolves the active locale's translation.
	if (locale === 'en') return null;
	const key = HOMEGROWN_VOICE_KEYS[id];
	if (key) {
		const message = (m as Record<string, () => string>)[key];
		if (typeof message === 'function') return { name: id, description: message(), whenToUse: '' };
	}
	return null;
}

/** Overlay one wire row: localized words when voiced, verbatim otherwise. */
export function voicedSkillRow<Row extends { name: string; description: string }>(row: Row): Row {
	const voice = voiceFor(row.name);
	if (!voice) return row;
	return { ...row, description: voice.description || row.description };
}