// Duplicate-id dedupe: one id, one row, one folder (2026-10-05 open-design BUG).
// open-design ships blog-post / dashboard under two paths; the shelf model
// (id === folder name === install/uninstall key) cannot host both, so the
// snapshot collapses duplicates to the first row and warns.
import { describe, expect, it, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeWorkspace, runEngine, cleanup } from './helpers'

const cleanupList: string[] = []
afterEach(() => { while (cleanupList.length) cleanup(cleanupList.pop()!) })

describe('duplicate-id dedupe in buildSnapshot', () => {
  it('a source listing the same id at two paths yields ONE row + source-duplicate-id warning', () => {
    const tree = mkdtempSync(join('/tmp', 'shelf-dupe-'))
    cleanupList.push(tree)
    // Five folders share the id p-skill-01 (canonical + four strays).
    for (const rel of ['pstack/skills/p-skill-01', 'pstack/extra/p-skill-01', 'pstack/misc/p-skill-01', 'pstack/other2/p-skill-01', 'pstack/other3/p-skill-01', 'pstack/skills/p-skill-02']) {
      mkdirSync(join(tree, rel), { recursive: true })
      writeFileSync(join(tree, rel, 'SKILL.md'), '---\nname: ' + rel.split('/').pop() + '\n---\ndup fixture\n')
    }
    const ws = makeWorkspace()
    cleanupList.push(ws.root)
    const out = runEngine(['refresh', '--skr', ws.skr, '--cache', ws.cache, '--skills-dir', ws.skillsDir, '--fixture-root', tree])
    expect(out.ok).toBe(true)
    const pstack = out.snapshot.sources.find((s: { id: string }) => s.id === 'pstack')
    const rows = pstack.skills.filter((k: { id: string }) => k.id === 'p-skill-01')
    expect(rows).toHaveLength(1)
    expect(rows[0].path).toBe('skills/p-skill-01') // canonical prefix path wins
    expect(rows[0].dup).toBe(true) // the kept row is marked as a duplicate-id survivor
    const other = pstack.skills.find((k: { id: string }) => k.id === 'p-skill-02')
    expect(other?.dup).toBeUndefined() // unique ids carry no marker
    expect(out.snapshot.warnings.some((w: { code: string }) => w.code === 'source-duplicate-id')).toBe(true)
    // One short line per source — the panel prints details verbatim.
    const dupe = out.snapshot.warnings.find((w: { code: string }) => w.code === 'source-duplicate-id')!
    expect(dupe.detail).toBe('source "pstack" has duplicate skill ids (kept first occurrence)')
  })
})
