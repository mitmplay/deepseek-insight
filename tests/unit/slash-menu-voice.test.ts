// 3.3-T - the voice overlay: homegrown key guard (D7) + overlay behavior.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { HOMEGROWN_VOICE_KEYS, ensureVoiceMap, voicedSkillRow } from '../../src/lib/services/chat/skill-voice.svelte';
import * as messages from '../../src/lib/paraglide/messages';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true, voice: {
    'shelf-zh-skill': { zh: { name: 'zh-skill', description: '中文描述', whenToUse: '' }, en: { name: 'zh-skill', description: 'chinese', whenToUse: '' } }
  } }), { headers: { 'content-type': 'application/json' } }))));
});
afterEach(() => vi.unstubAllGlobals());

describe('homegrown voice keys (D7)', () => {
  it('every homegrown key resolves to a compiled paraglide message', () => {
    for (const [id, key] of Object.entries(HOMEGROWN_VOICE_KEYS)) {
      expect((messages as Record<string, unknown>)[key], 'missing message for ' + id).toBeTruthy();
    }
  });

  it('the table is non-empty and only covers dsi-*/dsh-* ids', () => {
    expect(Object.keys(HOMEGROWN_VOICE_KEYS).length).toBeGreaterThanOrEqual(9);
    for (const id of Object.keys(HOMEGROWN_VOICE_KEYS)) {
      expect(id.startsWith('dsi-') || id.startsWith('dsh-')).toBe(true);
    }
  });
});

describe('voice overlay', () => {
  it('voiceFor resolves a sidecar entry after ensureVoiceMap', async () => {
    await ensureVoiceMap();
    const row = { name: 'shelf-zh-skill', description: 'wire english' };
    // happy-dom default locale is en - the en sidecar wins
    const voiced = voicedSkillRow(row);
    expect(voiced.description).toBe('chinese');
  });

  it('an unvoiced row passes through verbatim', () => {
    const row = { name: 'unknown-skill', description: 'wire english' };
    expect(voicedSkillRow(row).description).toBe('wire english');
  });
});