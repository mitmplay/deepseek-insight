// 1.1-T — Shelf Credentials (ADR 2026-09-22 D1/D2): the engine harvests
// the collection version (fixture package.json) and the SKR author link
// into the snapshot; absent facts degrade to null.
import { describe, expect, it, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
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

describe('shelf credentials (engine refresh)', () => {
  it('authorUrl rides from the SKR line into every source', () => {
    const { base } = fresh()
    const out = runEngine(base)
    expect(out.ok).toBe(true)
    for (const s of out.snapshot.sources) {
      expect(s.authorUrl).toMatch(/^https:\/\/www\.linkedin\.com\//)
    }
  })

  it('version harvested from fixture package.json where present, null where absent', () => {
    const { tree, base } = fresh()
    writeFileSync(join(tree, 'pstack', 'package.json'), JSON.stringify({ name: 'pstack', version: '6.4.0' }))
    const out = runEngine(base)
    const [p, m, s] = out.snapshot.sources
    expect(p.version).toBe('6.4.0')
    expect(m.version).toBeNull()
    expect(s.version).toBeNull()
  })

  it('package.json without a version string degrades to null', () => {
    const { tree, base } = fresh()
    writeFileSync(join(tree, 'pstack', 'package.json'), JSON.stringify({ name: 'pstack' }))
    const out = runEngine(base)
    expect(out.snapshot.sources[0].version).toBeNull()
  })

  it('wire pin untouched: snapshot stays v1 with the new fields present', () => {
    const { base } = fresh()
    const out = runEngine(base)
    expect(out.snapshot.v).toBe(1)
    expect(out.snapshot.sources[0]).toHaveProperty('version')
    expect(out.snapshot.sources[0]).toHaveProperty('authorUrl')
  })
})
