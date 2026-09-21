// 3.2-T - GET /api/skills/voice reads SHELF_SKILLS_DIR (env seam, no mocks).
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const prev = process.env.SHELF_SKILLS_DIR;
const dir = mkdtempSync(join(tmpdir(), 'voice-route-'));
mkdirSync(join(dir, 'shelf-one', '.dsi-voice'), { recursive: true });
writeFileSync(join(dir, 'shelf-one', '.dsi-voice', 'en.json'), JSON.stringify({ v: 1, name: 'one', description: 'english', whenToUse: '' }));
process.env.SHELF_SKILLS_DIR = dir;

const { GET } = await import('../../../../src/routes/api/skills/voice/+server');

afterAll(() => {
  if (prev === undefined) delete process.env.SHELF_SKILLS_DIR;
  else process.env.SHELF_SKILLS_DIR = prev;
});

describe('GET /api/skills/voice', () => {
  it('returns the merged map from the configured skills dir', async () => {
    const res = await GET({} as never);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.voice['shelf-one'].en.description).toBe('english');
  });
});