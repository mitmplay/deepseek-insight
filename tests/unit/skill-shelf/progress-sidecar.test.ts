// The progress sidecar (KB: the-progress-sidecar): refresh --reload
// writes skr-progress.json per step and deletes it at end of run —
// absence is the idle signal the reload button polls through
// GET /api/skills/progress. The repo-external engine that carried this
// was lost 2026-10-05; this reimplements and pins it.
import { describe, expect, it, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFixtureTree, makeWorkspace, runEngine, cleanup } from './helpers'

const trees: string[] = []
const cleanupList: string[] = []
afterEach(() => { while (trees.length) cleanup(trees.pop()!); while (cleanupList.length) cleanup(cleanupList.pop()!) })

describe('refresh --reload progress sidecar', () => {
  it('a plain refresh writes NO sidecar; a reload harvest ends with done=total, all done', () => {
    const tree = makeFixtureTree(); trees.push(tree)
    const ws = makeWorkspace(); cleanupList.push(ws.root)
    const progPath = join(mkdtempSync(join(tmpdir(), 'shelf-prog-')), 'skr-progress.json'); cleanupList.push(progPath)
    const base = ['--skr', ws.skr, '--cache', ws.cache, '--skills-dir', ws.skillsDir, '--fixture-root', tree]

    // Plain refresh (cache absent -> harvests) must stay sidecar-silent.
    runEngine(['refresh', ...base])
    expect(existsSync(progPath)).toBe(false)

    // Reload harvest with an explicit sidecar path + keep flag: inspect
    // the final state the UI's poll would have climbed through.
    const out = runEngine(['refresh', '--reload', '--progress-path', progPath, '--progress-keep', ...base])
    expect(out.ok).toBe(true)
    expect(existsSync(progPath)).toBe(true)
    const prog = JSON.parse(readFileSync(progPath, 'utf8'))
    expect(prog.running).toBe(true)
    expect(prog.total).toBeGreaterThan(0)
    expect(prog.done).toBe(prog.total)
    expect(prog.skillTotal).toBeGreaterThan(0)
    expect(prog.skillDone).toBe(prog.skillTotal)
    for (const s of prog.sources) expect(s.state).toBe('done')
  })

  it('without --progress-keep the sidecar is DELETED at end of run (absence = idle)', () => {
    const tree = makeFixtureTree(); trees.push(tree)
    const ws = makeWorkspace(); cleanupList.push(ws.root)
    const progPath = join(mkdtempSync(join(tmpdir(), 'shelf-prog-')), 'skr-progress.json'); cleanupList.push(progPath)
    const out = runEngine(['refresh', '--reload', '--progress-path', progPath, '--skr', ws.skr, '--cache', ws.cache, '--skills-dir', ws.skillsDir, '--fixture-root', tree])
    expect(out.ok).toBe(true)
    expect(existsSync(progPath)).toBe(false)
  })
})
