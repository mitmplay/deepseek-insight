// Shared helpers for skill-shelf engine tests (fixture trees, spawn wrapper).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const ENGINE = '/Users/wharsojo/.agents/skills/dsi-skill-shelf/shelf.mjs'

// Upstream-identical layout: pstack 47, mattpocock 38 (18 eng + 7 prod + 4 misc + 9 in-progress), superpowers 15.
export const FIXTURE_SHAPE = [
  { source: 'pstack', dirs: [['pstack', 'skills'], ...Array.from({ length: 47 }, (_, i) => ['pstack', 'skills', 'p-skill-' + String(i + 1).padStart(2, '0')])] },
  { source: 'mattpocock', dirs: [
    ...Array.from({ length: 18 }, (_, i) => ['skills', 'engineering', 'm-eng-' + String(i + 1).padStart(2, '0')]),
    ...Array.from({ length: 7 }, (_, i) => ['skills', 'productivity', 'm-prod-' + String(i + 1).padStart(2, '0')]),
    ...Array.from({ length: 4 }, (_, i) => ['skills', 'misc', 'm-misc-' + String(i + 1).padStart(2, '0')]),
    ...Array.from({ length: 9 }, (_, i) => ['skills', 'in-progress', 'm-wip-' + String(i + 1).padStart(2, '0')])
  ] },
  { source: 'superpowers', dirs: [['skills'], ...Array.from({ length: 15 }, (_, i) => ['skills', 's-skill-' + String(i + 1).padStart(2, '0')])] }
]

export function makeFixtureTree() {
  const root = mkdtempSync(join(tmpdir(), 'shelf-fixture-'))
  for (const { source, dirs } of FIXTURE_SHAPE) {
    for (const parts of dirs) {
      const dir = join(root, source, ...parts)
      mkdirSync(dir, { recursive: true })
      if (parts[parts.length - 1].startsWith('p-skill') || parts[parts.length - 1].startsWith('m-') || parts[parts.length - 1].startsWith('s-skill')) {
        writeFileSync(join(dir, 'SKILL.md'), '---\nname: ' + parts[parts.length - 1] + '\n---\nfixture skill\n')
      }
    }
  }
  return root
}

export function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'shelf-ws-'))
  const skillsDir = join(root, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  mkdirSync(join(root, 'res'), { recursive: true })
  return { root, skillsDir, cache: join(root, 'res', 'skr-cache.json'), skr: '/Users/wharsojo/agentic-ai/deepseek-insight/tests/fixtures/skill-shelf/skills-reff.md' }
}

export function runEngine(args: string[]) {
  // shelf.mjs fetches raw overviews for uninstalled skills even under
  // --fixture-root (buildSnapshot -> fetchOverview is not fixture-gated).
  // The engine runs in a child process, so stub fetch there via a preload.
  const env = { ...process.env }
  const stub = '--require ' + join(import.meta.dirname, 'no-fetch.cjs')
  env.NODE_OPTIONS = env.NODE_OPTIONS ? env.NODE_OPTIONS + ' ' + stub : stub
  try {
    const stdout = execFileSync('node', [ENGINE, ...args], { encoding: 'utf8', env })
    return JSON.parse(stdout)
  } catch (e) {
    return JSON.parse((e as { stdout: string }).stdout)
  }
}

export function cleanup(dir: string) { rmSync(dir, { recursive: true, force: true }) }
