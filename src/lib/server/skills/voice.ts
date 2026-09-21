/**
 * skill-voice (The Shelf Voice ADR D5) - the merged voice map: one entry
 * per shelf-installed skill carrying its per-locale words, read from the
 * .dsi-voice/<locale>.json sidecars the engine wrote at install time.
 * Homegrown dsi-* skills are NOT here - their voice is compile-time
 * paraglide (D7), resolved client-side.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const VOICE_LOCALES = ['en', 'zh', 'id', 'es'] as const;
export const VOICE_DIR = '.dsi-voice';

export interface VoiceEntry {
	name: string;
	description: string;
	whenToUse: string;
}

export type VoiceMap = Record<string, Record<string, VoiceEntry>>;

export function buildVoiceMap(skillsDir: string): VoiceMap {
	const map: VoiceMap = {};
	if (!existsSync(skillsDir)) return map;
	for (const skillId of readdirSync(skillsDir)) {
		const voiceDir = join(skillsDir, skillId, VOICE_DIR);
		if (!existsSync(voiceDir)) continue;
		for (const locale of VOICE_LOCALES) {
			const file = join(voiceDir, locale + '.json');
			if (!existsSync(file)) continue;
			try {
				const entry = JSON.parse(readFileSync(file, 'utf8')) as VoiceEntry & { v?: number };
				if (typeof entry?.name === 'string' && typeof entry?.description === 'string') {
					map[skillId] = map[skillId] ?? {};
					map[skillId][locale] = { name: entry.name, description: entry.description, whenToUse: String(entry.whenToUse ?? '') };
				}
			} catch {
				// a malformed sidecar is skipped, never fatal (D5 scan is best-effort)
			}
		}
	}
	return map;
}