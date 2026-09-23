/**
 * skill-voice branch mop (The Shelf Voice ADR D5/D7): pins the
 * offline/failed-wire arms of ensureVoiceMap and the homegrown paraglide
 * overlay arms of voiceFor that the slash-menu voice suite doesn't reach.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as messages from '../../src/lib/paraglide/messages';
import { setLocale, currentLocale } from '../../src/lib/services/locale/locale-state.svelte';

async function freshVoice() {
	vi.resetModules();
	return await import('../../src/lib/services/chat/skill-voice.svelte');
}

function okRes(body: unknown): Response {
	return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
	vi.unstubAllGlobals();
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe('ensureVoiceMap failure arms', () => {
	it('a rejected fetch leaves the overlay empty and rows verbatim (offline arm)', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
		const { ensureVoiceMap, voiceFor, voicedSkillRow } = await freshVoice();
		await expect(ensureVoiceMap()).resolves.toBeUndefined();
		const row = { name: 'shelf-skill', description: 'wire english' };
		expect(voiceFor('shelf-skill')).toBeNull();
		expect(voicedSkillRow(row).description).toBe('wire english');
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('a not-ok wire body keeps the map empty (body.ok false arm)', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okRes({ ok: false, error: 'nope' }))));
		const { ensureVoiceMap, voiceFor } = await freshVoice();
		await ensureVoiceMap();
		expect(voiceFor('shelf-skill')).toBeNull();
	});

	it('an ok body without a voice payload maps to an empty overlay (?? {} arm)', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okRes({ ok: true }))));
		const { ensureVoiceMap, voiceFor } = await freshVoice();
		await ensureVoiceMap();
		expect(voiceFor('shelf-skill')).toBeNull();
	});

	it('the wire is fetched once: the second ensureVoiceMap is a no-op (fetched gate)', async () => {
		const fetchMock = vi.fn(() => Promise.resolve(okRes({ ok: true, voice: {} })));
		vi.stubGlobal('fetch', fetchMock);
		const { ensureVoiceMap } = await freshVoice();
		await ensureVoiceMap();
		await ensureVoiceMap();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe('voiceFor homegrown + sidecar arms (non-en locale)', () => {
	it('an en-only sidecar wins under zh; an unknown non-en id falls to null', async () => {
		vi.stubGlobal('fetch', vi.fn(() =>
			Promise.resolve(okRes({ ok: true, voice: {
				'shelf-skill': { en: { name: 'shelf-skill', description: 'sidecar english', whenToUse: 'now' } }
			} }))
		));
		const { ensureVoiceMap, voiceFor, voicedSkillRow } = await freshVoice();
		await setLocale('zh');
		expect(currentLocale()).toBe('zh');
		await ensureVoiceMap();
		// active-locale sidecar missing -> en sidecar arm
		expect(voiceFor('shelf-skill')?.description).toBe('sidecar english');
		// unknown id, non-en locale: no sidecar, no homegrown key -> null
		expect(voiceFor('mystery-skill')).toBeNull();
		// overlay: voiced row keeps its wire shape, voice description wins
		const row = { name: 'shelf-skill', description: 'wire english' };
		expect(voicedSkillRow(row)).toEqual({ name: 'shelf-skill', description: 'sidecar english' });
	});

	it('a homegrown dsi-* id resolves through its compiled paraglide key (D7)', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okRes({ ok: true, voice: {} }))));
		const { ensureVoiceMap, voiceFor, voicedSkillRow } = await freshVoice();
		await setLocale('zh');
		await ensureVoiceMap();
		const voice = voiceFor('dsi-adr');
		expect(voice).not.toBeNull();
		expect(voice?.name).toBe('dsi-adr');
		expect(voice?.description).toBe((messages as unknown as Record<string, () => string>).skillsVoiceDsiAdr());
		// the overlay swaps the description in, keeps the rest of the row
		const row = { name: 'dsi-adr', description: 'wire english', extra: 7 };
		const voiced = voicedSkillRow(row);
		expect(voiced.description).toBe(voice?.description);
		expect((voiced as typeof row).extra).toBe(7);
	});

	it('a homegrown key that misses the compiled table degrades to null (message lookup arm)', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okRes({ ok: true, voice: {} }))));
		const { ensureVoiceMap, voiceFor } = await freshVoice();
		await setLocale('zh');
		await ensureVoiceMap();
		const { HOMEGROWN_VOICE_KEYS } = await import('../../src/lib/services/chat/skill-voice.svelte');
		HOMEGROWN_VOICE_KEYS['fake-skill'] = 'noSuchCompiledMessage';
		expect(voiceFor('fake-skill')).toBeNull();
	});
});
