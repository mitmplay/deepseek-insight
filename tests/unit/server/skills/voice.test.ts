// 3.1-T - buildVoiceMap: sidecar scan, locale merge, malformed skip.
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildVoiceMap } from '../../../../src/lib/server/skills/voice';

let dir: string | null = null;
afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; } });

function seeded(skills: Record<string, Record<string, object>>) {
  dir = mkdtempSync(join(tmpdir(), 'voice-map-'));
  for (const [id, locales] of Object.entries(skills)) {
    for (const [locale, entry] of Object.entries(locales)) {
      const d = join(dir, id, '.dsi-voice');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, locale + '.json'), JSON.stringify(entry));
    }
  }
  return dir;
}

describe('buildVoiceMap', () => {
  it('merges per-locale sidecars per skill id', () => {
    const d = seeded({
      'shelf-one': {
        en: { name: 'one', description: 'english', whenToUse: '' },
        zh: { name: '壹', description: '中文', whenToUse: '时' }
      }
    });
    const map = buildVoiceMap(d);
    expect(map['shelf-one'].en.description).toBe('english');
    expect(map['shelf-one'].zh.name).toBe('壹');
  });

  it('skips malformed sidecars without dying (best-effort scan)', () => {
    const d = seeded({});
    mkdirSync(join(d, 'broken', '.dsi-voice'), { recursive: true });
    writeFileSync(join(d, 'broken', '.dsi-voice', 'en.json'), '{nope');
    const map = buildVoiceMap(d);
    expect(map['broken']).toBeUndefined();
  });

  it('missing skills dir yields an empty map', () => {
    const map = buildVoiceMap('/nonexistent-voice-dir');
    expect(map).toEqual({});
  });
});