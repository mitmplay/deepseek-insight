import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSnapshot } from '../../../.agents/skills/dsi-plugin-rack/rack.mjs';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pgr-shadow-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeGarden(repoRoot: string) {
  const garden = join(tmp, 'plugins');
  mkdirSync(join(garden, 'dsh-research-preset'), { recursive: true });
  writeFileSync(join(garden, 'dsh-research-preset', 'package.json'), JSON.stringify({
    name: '@local/dsh-research-preset', version: '1.0.0', private: true,
    dsh: { bundle: { patch: './cordis.patch.yml' } }
  }));
  writeFileSync(join(garden, 'dsh-research-preset', 'cordis.patch.yml'), 'x: 1');
  return { garden, gardenRepo: repoRoot };
}

function makeReff(lines: string[]) {
  const reff = join(tmp, 'reff.md');
  writeFileSync(reff, ['Plugins Resources:', ...lines].join('\n'));
  return reff;
}

describe('reff shadowed by garden (ADR-0016 D2/D3)', () => {
  it('same-repo reff line yields ONE group, no duplicate id, warning emitted', () => {
    const { garden, gardenRepo } = makeGarden('https://github.com/mitmplay/deepseek-insight');
    const reff = makeReff([
      '2. [deepseek-insight](https://github.com/mitmplay/deepseek-insight/tree/main/plugins) - [deepseek-insight](https://github.com/mitmplay)',
      '3. [superpowers-dsh](https://github.com/LayneChai/superpowers-dsh) - [LayneChai](https://github.com/LayneChai)'
    ]);
    const { snapshot, warnings } = buildSnapshot({ reffPath: reff, manifestPath: join(tmp, 'none.json'), gardenPath: garden, gardenRepo, profile: 'web' });
    expect(snapshot.plugins.map((p) => p.id)).not.toContain('deepseek-insight');
    expect(snapshot.plugins.some((p) => p.id === 'superpowers-dsh')).toBe(true);
    expect(snapshot.sources).toHaveLength(2);
    expect(snapshot.sources.map((s) => s.id)).toContain('mitmplay/deepseek-insight');
    expect(snapshot.sources.map((s) => s.id)).not.toContain('main/plugins');
    expect(warnings.some((w) => w.code === 'reff-shadowed-by-garden' && w.detail === 'deepseek-insight')).toBe(true);
  });

  it('a /tree URL on a FOREIGN repo is NOT shadowed', () => {
    const { garden, gardenRepo } = makeGarden('https://github.com/mitmplay/deepseek-insight');
    const reff = makeReff(['1. [sub-plugin](https://github.com/NanmiCoder/dsh-agent-teams/tree/main/pkg) - [NanmiCoder](https://github.com/NanmiCoder)']);
    const { snapshot, warnings } = buildSnapshot({ reffPath: reff, manifestPath: join(tmp, 'none.json'), gardenPath: garden, gardenRepo, profile: 'web' });
    expect(snapshot.plugins.some((p) => p.id === 'sub-plugin')).toBe(true);
    expect(warnings.some((w) => w.code === 'reff-shadowed-by-garden')).toBe(false);
  });

  it('no garden present — nothing shadows', () => {
    const reff = makeReff(['1. [deepseek-insight](https://github.com/mitmplay/deepseek-insight/tree/main/plugins) - [deepseek-insight](https://github.com/mitmplay)']);
    const { snapshot, warnings } = buildSnapshot({ reffPath: reff, manifestPath: join(tmp, 'none.json'), gardenPath: undefined, gardenRepo: undefined, profile: 'web' });
    expect(snapshot.plugins).toHaveLength(1);
    expect(warnings.some((w) => w.code === 'reff-shadowed-by-garden')).toBe(false);
  });
});
