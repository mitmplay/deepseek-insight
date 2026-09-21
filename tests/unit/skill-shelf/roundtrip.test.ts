// 1.4-T - full engine round trip: refresh, install, flags, uninstall, reload-from-signatures.
import { describe, expect, it, afterEach } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureTree, makeWorkspace, runEngine, cleanup } from './helpers'

const trees: string[] = []
const wsList: ReturnType<typeof makeWorkspace>[] = []
afterEach(() => { while (trees.length) cleanup(trees.pop()!); while (wsList.length) cleanup(wsList.pop()!.root) })

describe('engine round trip', () => {
  it('refresh, install, flags flip, uninstall, flags clear, delete snapshot, rebuild from signatures', () => {
    const tree = makeFixtureTree(); trees.push(tree)
    const ws = makeWorkspace(); wsList.push(ws)
    const base = ['refresh', '--skr', ws.skr, '--cache', ws.cache, '--skills-dir', ws.skillsDir, '--fixture-root', tree]
    const apply = (action: string, targets: string[], extra: string[] = []) =>
      runEngine(['apply', action, ...targets, '--cache', ws.cache, '--skills-dir', ws.skillsDir, '--fixture-root', tree, ...extra])

    let out = runEngine(base)
    expect(out.ok).toBe(true)
    let p01 = out.snapshot.sources[0].skills.find((s: any) => s.id === 'p-skill-01')
    expect(p01).toMatchObject({ installed: false, signed: false, installedFrom: null })

    expect(apply('install', ['1.1']).ok).toBe(true)

    out = runEngine([...base, '--reload'])
    p01 = out.snapshot.sources[0].skills.find((s: any) => s.id === 'p-skill-01')
    expect(p01.installed).toBe(true)
    expect(p01.signed).toBe(true)
    expect(p01.installedFrom).toBe('pstack')


    expect(apply('uninstall', ['p-skill-01']).ok).toBe(true)
    out = runEngine([...base, '--reload'])
    p01 = out.snapshot.sources[0].skills.find((s: any) => s.id === 'p-skill-01')
    expect(p01.installed).toBe(false)
    expect(p01.signed).toBe(false)

    const zhPayload = JSON.stringify({ zh: { name: '技能乙', description: '中文', whenToUse: '用于' } })
    expect(apply('install', ['1.2', '--voice', zhPayload]).ok).toBe(true)
    // voice sidecars ride the install and die with the uninstall (D3)
    expect(existsSync(join(ws.skillsDir, 'p-skill-02', '.dsi-voice', 'en.json'))).toBe(true)
    expect(existsSync(join(ws.skillsDir, 'p-skill-02', '.dsi-voice', 'zh.json'))).toBe(true)
    rmSync(ws.cache)  // snapshot lost; rebuild must source truth from signatures (state-homes rule)
    out = runEngine(base)
    expect(out.ok).toBe(true)
    expect(out.reused).toBe(false)
    p01 = out.snapshot.sources[0].skills.find((s: any) => s.id === 'p-skill-02')
    expect(p01.installed).toBe(true)
    expect(p01.signed).toBe(true)
    expect(p01.installedFrom).toBe('pstack')
  })
})