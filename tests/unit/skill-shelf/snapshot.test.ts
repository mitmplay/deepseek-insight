// 1.2-T — snapshot builder: counts, absent/present/--reload lifecycle, reconciliation.
import { describe, expect, it, afterEach } from 'vitest'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureTree, makeWorkspace, runEngine, cleanup } from './helpers'

const trees: string[] = []
const wsList: ReturnType<typeof makeWorkspace>[] = []
afterEach(() => { while (trees.length) cleanup(trees.pop()!); while (wsList.length) cleanup(wsList.pop()!.root) })

function fresh() {
  const tree = makeFixtureTree(); trees.push(tree)
  const ws = makeWorkspace(); wsList.push(ws)
  return { tree, ws, base: ['refresh', '--skr', ws.skr, '--cache', ws.cache, '--skills-dir', ws.skillsDir, '--fixture-root', tree] }
}

describe('snapshot builder (refresh)', () => {
  it('absent snapshot: builds with exact upstream counts 1.1-1.47 / 2.1-2.38 / 3.1-3.15', () => {
    const { base, ws } = fresh()
    const out = runEngine(base)
    expect(out.ok).toBe(true)
    expect(out.reused).toBe(false)
    expect(out.snapshot.v).toBe(1)
    const [p, m, s] = out.snapshot.sources
    expect(p.skills.length).toBe(47)
    expect(p.skills[0].n).toBe('1.1')
    expect(p.skills[46].n).toBe('1.47')
    expect(m.skills.length).toBe(38)
    expect(m.skills[0].n).toBe('2.1')
    expect(m.skills[37].n).toBe('2.38')
    expect(s.skills.length).toBe(15)
    expect(s.skills[0].n).toBe('3.1')
    expect(s.skills[14].n).toBe('3.15')
    expect(existsSync(ws.cache)).toBe(true)
  })

  it('present snapshot without --reload: reused untouched, generatedAt unchanged', () => {
    const { base, ws } = fresh()
    runEngine(base)
    const first = JSON.parse(readFileSync(ws.cache, 'utf8'))
    const out = runEngine(base)
    expect(out.ok).toBe(true)
    expect(out.reused).toBe(true)
    expect(out.snapshot.generatedAt).toBe(first.generatedAt)
  })

  it('--reload: rebuilds even when snapshot present', () => {
    const { base, ws } = fresh()
    runEngine(base)
    const first = JSON.parse(readFileSync(ws.cache, 'utf8'))
    const out = runEngine([...base, '--reload'])
    expect(out.ok).toBe(true)
    expect(out.reused).toBe(false)
    expect(out.snapshot.generatedAt).not.toBe(first.generatedAt)
  })

  it('reconciles installed flag from filesystem: hand-deleted folder flips installed off', () => {
    const { base, ws } = fresh()
    runEngine(base)
    rmSync(join(ws.skillsDir, 'p-skill-01'), { recursive: true, force: true })
    const out = runEngine([...base, '--reload'])
    const p = out.snapshot.sources[0]
    expect(p.skills.find((s: any) => s.id === 'p-skill-01').installed).toBe(false)
  })

  it('reconciles signed flag from signatures; unsigned folder is installed but not signed', () => {
    const { tree, base, ws } = fresh()
    runEngine(base)
    mkdirSync(join(ws.skillsDir, 'p-skill-01'), { recursive: true })
    cpSync(join(tree, 'pstack', 'pstack', 'skills', 'p-skill-01'), join(ws.skillsDir, 'p-skill-01'), { recursive: true })
    const out = runEngine([...base, '--reload'])
    const sk = out.snapshot.sources[0].skills.find((s: any) => s.id === 'p-skill-01')
    expect(sk.installed).toBe(true)
    expect(sk.signed).toBe(false)
    expect(sk.installedFrom).toBeNull()
  })

  it('in-progress tier is marked unstable', () => {
    const { base } = fresh()
    const out = runEngine(base)
    const wip = out.snapshot.sources[1].skills.find((s: any) => s.id === 'm-wip-01')
    expect(wip.tier).toBe('in-progress')
    const eng = out.snapshot.sources[1].skills.find((s: any) => s.id === 'm-eng-01')
    expect(eng.tier).toBeNull()
  })

  it('unknown SKR source AUTO-DERIVES enumeration from its github URL (2026-09-21 regression)', () => {
    const { tree, ws } = fresh()
    // a repo the engine has NEVER seen, laid out like addyosmani/web-quality-skills
    mkdirSync(join(tree, 'mystery-skills', 'skills', 'myskill-01'), { recursive: true })
    writeFileSync(join(tree, 'mystery-skills', 'skills', 'myskill-01', 'SKILL.md'), '---\nname: myskill-01\n---\nfixture\n')
    const skr = join(ws.root, 'skr-custom.md')
    writeFileSync(
      skr,
      '1. [pstack](https://github.com/cursor/plugins) - [Lauren Tan](https://www.linkedin.com/in/laurentan/)\n' +
        '2. [mystery-skills](https://github.com/someone/mystery-skills) - [Anon](https://www.linkedin.com/in/anon/)\n'
    )
    const out = runEngine(['refresh', '--skr', skr, '--cache', ws.cache, '--skills-dir', ws.skillsDir, '--fixture-root', tree])
    expect(out.ok).toBe(true)
    const mystery = out.snapshot.sources.find((s: any) => s.id === 'mystery-skills')
    expect(mystery.skills.length).toBe(1)
    expect(mystery.skills[0].id).toBe('myskill-01')
    expect(out.snapshot.warnings ?? []).toEqual([])
    // known sources keep enumerating
    expect(out.snapshot.sources.find((s: any) => s.id === 'pstack').skills.length).toBe(47)
  })

  it('SKR source with a NON-github URL: empty skills AND a source-no-repo warning', () => {
    const { base, ws } = fresh()
    const skr = join(ws.root, 'skr-gitlab.md')
    writeFileSync(skr, '1. [gitlab-only](https://gitlab.com/someone/gitlab-only) - [Anon](https://www.linkedin.com/in/anon/)\n')
    const out = runEngine(['refresh', '--skr', skr, '--cache', ws.cache, '--skills-dir', ws.skillsDir, '--fixture-root', base[base.length - 1]])
    expect(out.ok).toBe(true)
    expect(out.snapshot.sources.find((s: any) => s.id === 'gitlab-only').skills.length).toBe(0)
    const warn = (out.snapshot.warnings ?? []).find((w: any) => w.source === 'gitlab-only')
    expect(warn?.code).toBe('source-no-repo')
  })
})
