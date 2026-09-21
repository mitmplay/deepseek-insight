// 2.1-T - voice sidecars: per-locale write, invalid payload degrades to en (D4),
// uninstall removes voice with the folder.
import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixtureTree, makeWorkspace, runEngine, cleanup } from './helpers';

const trees: string[] = [];
const wsList: ReturnType<typeof makeWorkspace>[] = [];
afterEach(() => { while (trees.length) cleanup(trees.pop()!); while (wsList.length) cleanup(wsList.pop()!.root) });

function fresh() {
  const tree = makeFixtureTree(); trees.push(tree);
  const ws = makeWorkspace(); wsList.push(ws);
  const base = ['refresh', '--skr', ws.skr, '--cache', ws.cache, '--skills-dir', ws.skillsDir, '--fixture-root', tree];
  runEngine(base);
  const apply = (action: string, targets: string[], extra: string[] = []) =>
    runEngine(['apply', action, ...targets, '--cache', ws.cache, '--skills-dir', ws.skillsDir, '--fixture-root', tree, ...extra]);
  return { ws, apply };
}

const ZH_VOICE = JSON.stringify({ zh: { name: '技能', description: '中文描述', whenToUse: '何时使用' } });

describe('voice sidecars', () => {
  it('install writes the en scaffold always, and provided locales verbatim', () => {
    const { ws, apply } = fresh();
    const out = apply('install', ['1.1', '--voice', ZH_VOICE]);
    expect(out.ok).toBe(true);
    expect(out.results[0].voice).toEqual(expect.arrayContaining(['en', 'zh']));
    const dir = join(ws.skillsDir, 'p-skill-01', '.dsi-voice');
    const en = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8'));
    expect(en.name).toBe('p-skill-01');
    expect(en.v).toBe(1);
    const zh = JSON.parse(readFileSync(join(dir, 'zh.json'), 'utf8'));
    expect(zh.name).toBe('技能');
    expect(zh.description).toBe('中文描述');
  });

  it('an invalid payload NEVER blocks the install - degrades to en-only with a voiceError (D4)', () => {
    const { ws, apply } = fresh();
    const bad = apply('install', ['1.1', '--voice', JSON.stringify({ xx: { name: 'x' } })]);
    expect(bad.results[0].ok).toBe(true);
    expect(String(bad.results[0].voiceError)).toContain('unsupported locale');
    const dir = join(ws.skillsDir, 'p-skill-01', '.dsi-voice');
    expect(existsSync(join(dir, 'en.json'))).toBe(true);
    expect(existsSync(join(dir, 'xx.json'))).toBe(false);
  });

  it('malformed JSON payload degrades to en-only too', () => {
    const { ws, apply } = fresh();
    const out = apply('install', ['1.2', '--voice', '{not-json']);
    expect(out.results[0].ok).toBe(true);
    expect(String(out.results[0].voiceError)).toBeTruthy();
    expect(existsSync(join(ws.skillsDir, 'p-skill-02', '.dsi-voice', 'en.json'))).toBe(true);
  });

  it('uninstall removes voice with the folder (sidecars travel, never linger)', () => {
    const { ws, apply } = fresh();
    apply('install', ['1.1', '--voice', ZH_VOICE]);
    apply('uninstall', ['p-skill-01']);
    expect(existsSync(join(ws.skillsDir, 'p-skill-01'))).toBe(false);
  });
});
