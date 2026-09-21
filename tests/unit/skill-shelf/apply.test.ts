// 1.3-T — signed apply: atomic install-or-nothing, unsigned uninstall refusal, tier rule, collisions.
import { describe, expect, it, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureTree, makeWorkspace, runEngine, cleanup } from './helpers'

const trees: string[] = []
const wsList: ReturnType<typeof makeWorkspace>[] = []
afterEach(() => { while (trees.length) cleanup(trees.pop()!); while (wsList.length) cleanup(wsList.pop()!.root) })

function fresh() {
  const tree = makeFixtureTree(); trees.push(tree)
  const ws = makeWorkspace(); wsList.push(ws)
  const base = ['refresh', '--skr', ws.skr, '--cache', ws.cache, '--skills-dir', ws.skillsDir, '--fixture-root', tree]
  runEngine(base)
  return { ws, apply: (action: string, targets: string[], extra: string[] = []) =>
    runEngine(['apply', action, ...targets, '--cache', ws.cache, '--skills-dir', ws.skillsDir, '--fixture-root', tree, ...extra]) }
}

describe('signed apply', () => {
  it('install writes folder AND signature with provenance fields', () => {
    const { ws, apply } = fresh()
    const out = apply('install', ['1.1'])
    expect(out.ok).toBe(true)
    const dir = join(ws.skillsDir, 'p-skill-01')
    expect(existsSync(dir)).toBe(true)
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(true)
    const sig = JSON.parse(readFileSync(join(dir, '.dsi-provenance.json'), 'utf8'))
    expect(sig.source).toBe('pstack')
    expect(sig.n).toBe('1.1')
    expect(sig.skillId).toBe('p-skill-01')
    expect(sig.upstreamPath).toBe('pstack/pstack/skills/p-skill-01')
    expect(sig.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(sig.v).toBe(1)
  })

  it('uninstall removes folder + signature only when signed (D5)', () => {
    const { ws, apply } = fresh()
    apply('install', ['1.1'])
    const out = apply('uninstall', ['p-skill-01'])
    expect(out.ok).toBe(true)
    expect(existsSync(join(ws.skillsDir, 'p-skill-01'))).toBe(false)
  })

  it('uninstall of an unsigned folder is a hard refusal', () => {
    const { ws, apply } = fresh()
    mkdirSync(join(ws.skillsDir, 'p-skill-01'), { recursive: true })
    writeFileSync(join(ws.skillsDir, 'p-skill-01', 'SKILL.md'), 'hand copied')
    const out = apply('uninstall', ['p-skill-01'])
    expect(out.ok).toBe(false)
    expect(out.results[0].error).toContain('unsigned')
    expect(existsSync(join(ws.skillsDir, 'p-skill-01'))).toBe(true)
  })

  it('unstable tier requires explicit --allow-unstable; stable install unaffected', () => {
    const { ws, apply } = fresh()
    const refused = apply('install', ['2.30'])
    expect(refused.results[0].ok).toBe(false)
    expect(refused.results[0].error).toContain('unstable')
    const allowed = apply('install', ['2.30'], ['--allow-unstable'])
    expect(allowed.results[0].ok).toBe(true)
    expect(existsSync(join(ws.skillsDir, 'm-wip-01'))).toBe(true)
    const stable = apply('install', ['3.1'])
    expect(stable.results[0].ok).toBe(true)
  })

  it('collision aborts without partial writes unless --force', () => {
    const { ws, apply } = fresh()
    mkdirSync(join(ws.skillsDir, 'p-skill-01'), { recursive: true })
    writeFileSync(join(ws.skillsDir, 'p-skill-01', 'operator-file.txt'), 'precious')
    const refused = apply('install', ['1.1'])
    expect(refused.results[0].ok).toBe(false)
    expect(refused.results[0].error).toContain('collision')
    expect(readFileSync(join(ws.skillsDir, 'p-skill-01', 'operator-file.txt'), 'utf8')).toBe('precious')
    const forced = apply('install', ['1.1'], ['--force'])
    expect(forced.results[0].ok).toBe(true)
    expect(existsSync(join(ws.skillsDir, 'p-skill-01', 'operator-file.txt'))).toBe(false)
  })

  it('apply flips the cache flags so the panel refetch shows true state (live-verified BUG)', () => {
    const { ws, apply } = fresh();
    apply('install', ['1.1']);
    const cache1 = JSON.parse(readFileSync(ws.cache, 'utf8'));
    const installed = cache1.sources[0].skills.find((s) => s.id === 'p-skill-01');
    expect(installed.installed).toBe(true);
    expect(installed.signed).toBe(true);
    expect(installed.installedFrom).toBe('pstack');
    apply('uninstall', ['p-skill-01']);
    const cache2 = JSON.parse(readFileSync(ws.cache, 'utf8'));
    const uninstalled = cache2.sources[0].skills.find((s) => s.id === 'p-skill-01');
    expect(uninstalled.installed).toBe(false);
    expect(uninstalled.signed).toBe(false);
    expect(uninstalled.installedFrom).toBeNull();
  });

  it('missing snapshot: apply fails loudly with refresh hint', () => {
    const tree = makeFixtureTree(); trees.push(tree)
    const ws = makeWorkspace(); wsList.push(ws)
    const out = runEngine(['apply', 'install', '1.1', '--cache', ws.cache, '--skills-dir', ws.skillsDir, '--fixture-root', tree])
    expect(out.ok).toBe(false)
    expect(out.errors[0]).toContain('refresh')
  })
})