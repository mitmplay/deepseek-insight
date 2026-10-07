// Rack engine tests (Task 1.1-T) — fixture reff/manifest + fake dsh, never real home.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterAll } from 'vitest'

const ENGINE = '/Users/wharsojo/.agents/skills/dsi-plugin-rack/rack.mjs'

const REFF = [
  'Plugins Resources:',
  '1. [dsh-rules-paths](https://github.com/Temoa/dsh-rules-paths) - [Temoa](https://github.com/Temoa)',
  '2. [RuleBase](https://github.com/mycodesite/dsh-rules) - [mycodesite](https://github.com/mycodesite)',
  ''
].join('\n')

function fakeDsh(dir: string) {
  // Records its args to dsh.log, mutates the manifest fixture per FAKE_EXIT /
  // FAKE_MUTATE, so the engine's manifest re-read (D4 authority) is exercised.
  const p = join(dir, 'fake-dsh.mjs')
  writeFileSync(p, [
    "import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'",
    "const args = process.argv.slice(2)",
    "// engine cmd shape: plugin --profile <p> <add|remove> <spec|id>",
    "const action = args[3]",
    "const spec = args[4]",
    "appendFileSync(process.env.FAKE_LOG, args.join(' ') + '\\n')",
    "if (process.env.FAKE_MUTATE === '1' && action === 'add') {",
    "  const mp = process.env.FAKE_MANIFEST",
    "  const doc = JSON.parse(readFileSync(mp, 'utf8'))",
    "  // Real pnpm behavior for git specs: the dep key is the package's",
    "  // OWN scoped name (@owner/name), not the repo tail.",
    "  const tail = (spec.split('github.com/')[1] || spec).replace(/\\.git$/, '')",
    "  const id = '@' + tail.split('/')[0].toLowerCase() + '/' + tail.split('/')[1]",
    "  doc.dependencies[id] = 'github:' + tail",
    "  writeFileSync(mp, JSON.stringify(doc))",
    "}",
    "if (process.env.FAKE_MUTATE === '1' && action === 'remove') {",
    "  const mp = process.env.FAKE_MANIFEST",
    "  const doc = JSON.parse(readFileSync(mp, 'utf8'))",
    "  const id = spec",
    "  delete doc.dependencies[id]",
    "  doc.dsh.profile.bundles = doc.dsh.profile.bundles.filter((b) => b !== id)",
    "  writeFileSync(mp, JSON.stringify(doc))",
    "}",
    "process.stderr.write('fake-dsh diagnostic line')",
    "process.exit(Number(process.env.FAKE_EXIT ?? 0))"
  ].join('\n'))
  return 'node ' + p
}

function workspace(manifestObj: Record<string, unknown> = { dependencies: {}, dsh: { profile: { bundles: [] } } }) {
  const root = mkdtempSync(join(tmpdir(), 'rack-ws-'))
  writeFileSync(join(root, 'reff.md'), REFF)
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifestObj))
  return { root, reff: join(root, 'reff.md'), cache: join(root, 'pgr-cache.json'), manifest: join(root, 'manifest.json') }
}

function runEngine(ws: ReturnType<typeof workspace>, args: string[], env: Record<string, string> = {}) {
  const e = { ...process.env, FAKE_MANIFEST: ws.manifest, FAKE_LOG: join(ws.root, 'dsh.log'), ...env }
  try {
    const stdout = execFileSync('node', [ENGINE, ...args], { encoding: 'utf8', env: e })
    return JSON.parse(stdout)
  } catch (err) {
    return JSON.parse((err as { stdout: string }).stdout)
  }
}

function dshCmd(ws: ReturnType<typeof workspace>) {
  return fakeDsh(ws.root)
}

const dirs: string[] = []
function tracked<T extends ReturnType<typeof workspace>>(ws: T): T { dirs.push(ws.root); return ws }
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

describe('rack engine — refresh lifecycle (D3)', () => {
  it('builds the snapshot when the cache is absent', () => {
    const ws = tracked(workspace())
    const p = runEngine(ws, ['refresh', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest])
    expect(p.v).toBe(2); // wire v2 (Plugin Garden ADR: group/description/version per row) expect(p.ok).toBe(true); expect(p.reused).toBeUndefined()
    expect(p.snapshot.plugins.map((x: { id: string }) => x.id)).toEqual(['dsh-rules-paths', 'RuleBase'])
    expect(p.snapshot.plugins.every((x: { installed: boolean }) => x.installed === false)).toBe(true)
  })
  it('reuses an existing cache untouched', () => {
    const ws = tracked(workspace())
    runEngine(ws, ['refresh', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest])
    const first = readFileSync(ws.cache, 'utf8')
    const p = runEngine(ws, ['refresh', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest])
    expect(p.reused).toBe(true)
    expect(readFileSync(ws.cache, 'utf8')).toBe(first)
  })
  it('--reload rebuilds and reconciles installed purely from the manifest (D4)', () => {
    const ws = tracked(workspace())
    runEngine(ws, ['refresh', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest])
    writeFileSync(ws.manifest, JSON.stringify({ dependencies: { 'dsh-rules-paths': 'git' }, dsh: { profile: { bundles: ['dsh-rules-paths'] } } }))
    const p = runEngine(ws, ['refresh', '--reload', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest])
    expect(p.reused).toBeUndefined()
    expect(p.snapshot.plugins.find((x: { id: string }) => x.id === 'dsh-rules-paths').installed).toBe(true)
    expect(p.snapshot.plugins.find((x: { id: string }) => x.id === 'RuleBase').installed).toBe(false)
  })
  it('reports an empty reff as a warning, not a crash', () => {
    const ws = tracked(workspace())
    writeFileSync(ws.reff, 'Plugins Resources:\n')
    const p = runEngine(ws, ['refresh', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest])
    expect(p.snapshot.plugins).toEqual([])
    expect(p.errors.some((e: string) => e.includes('reff-empty'))).toBe(true)
  })
})

describe('rack engine — apply via dsh (D3/D4/D6)', () => {
  it('install shells out to dsh with the git+ spec and flips the cache', () => {
    const ws = tracked(workspace())
    runEngine(ws, ['refresh', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest])
    const p = runEngine(ws, ['apply', 'install', '1', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest, '--dsh-cmd', dshCmd(ws)], { FAKE_MUTATE: '1' })
    expect(p.ok).toBe(true)
    expect(p.results[0]).toMatchObject({ id: 'dsh-rules-paths', ok: true })
    const log = readFileSync(join(ws.root, 'dsh.log'), 'utf8')
    expect(log).toContain('plugin --profile web add git+https://github.com/Temoa/dsh-rules-paths.git')
    const snap = JSON.parse(readFileSync(ws.cache, 'utf8'))
    expect(snap.plugins.find((x: { id: string }) => x.id === 'dsh-rules-paths').installed).toBe(true)
  })
  it('a failed add relays diagnostics verbatim and writes nothing (D6)', () => {
    const ws = tracked(workspace())
    runEngine(ws, ['refresh', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest])
    const before = readFileSync(ws.cache, 'utf8')
    const p = runEngine(ws, ['apply', 'install', '1', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest, '--dsh-cmd', dshCmd(ws)], { FAKE_EXIT: '3' })
    expect(p.ok).toBe(false)
    expect(p.results[0].error).toContain('exit 3')
    expect(p.results[0].error).toContain('fake-dsh diagnostic line')
    expect(readFileSync(ws.cache, 'utf8')).toBe(before)
  })
  it('distrusts a dsh success the manifest does not record (D4 authority)', () => {
    const ws = tracked(workspace())
    runEngine(ws, ['refresh', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest])
    // fake runs clean but FAKE_MUTATE unset → manifest untouched
    const p = runEngine(ws, ['apply', 'install', '1', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest, '--dsh-cmd', dshCmd(ws)])
    expect(p.ok).toBe(false)
    expect(p.results[0].error).toContain('manifest does not record')
  })
  it('install succeeds when pnpm records a SCOPED dep name; remove targets that pkg (D4 amendment)', async () => {
    const ws = tracked(workspace());
    runEngine(ws, ['refresh', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest]);
    const p = runEngine(ws, ['apply', 'install', '1', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest, '--dsh-cmd', dshCmd(ws)], { FAKE_MUTATE: '1' });
    expect(p.ok).toBe(true);
    expect(p.results[0]).toMatchObject({ id: 'dsh-rules-paths', ok: true, pkg: '@temoa/dsh-rules-paths' });
    const snap = JSON.parse(readFileSync(ws.cache, 'utf8'));
    expect(snap.plugins.find((x: { id: string }) => x.id === 'dsh-rules-paths').pkg).toBe('@temoa/dsh-rules-paths');
    // remove must target the RECORDED name, not the reff id
    const p2 = runEngine(ws, ['apply', 'remove', 'dsh-rules-paths', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest, '--dsh-cmd', dshCmd(ws)], { FAKE_MUTATE: '1' });
    expect(p2.ok).toBe(true);
    const log = readFileSync(join(ws.root, 'dsh.log'), 'utf8');
    expect(log).toContain('remove @temoa/dsh-rules-paths');
  });
  it('already-installed is an idempotent skip, no dsh call', () => {
    const ws = tracked(workspace({ dependencies: { 'dsh-rules-paths': 'git' }, dsh: { profile: { bundles: ['dsh-rules-paths'] } } }))
    runEngine(ws, ['refresh', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest])
    const p = runEngine(ws, ['apply', 'install', '1', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest, '--dsh-cmd', dshCmd(ws)])
    expect(p.results[0]).toMatchObject({ id: 'dsh-rules-paths', ok: true, already: true })
    expect(existsSyncMaybe(join(ws.root, 'dsh.log'))).toBe(false)
  })
  it('remove flips installed off; a manifest-foreign package is not on the rack', () => {
    const ws = tracked(workspace({ dependencies: { 'dsh-rules-paths': 'git', 'ov-plugin': 'git' }, dsh: { profile: { bundles: ['dsh-rules-paths', 'ov-plugin'] } } }))
    runEngine(ws, ['refresh', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest])
    // ov-plugin is in the manifest but NOT on the reff → never addressable (control matrix)
    const p = runEngine(ws, ['apply', 'remove', 'ov-plugin', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest, '--dsh-cmd', dshCmd(ws)], { FAKE_MUTATE: '1' })
    expect(p.ok).toBe(false)
    expect(p.results[0].error).toContain('not on the rack')
    const p2 = runEngine(ws, ['apply', 'remove', 'dsh-rules-paths', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest, '--dsh-cmd', dshCmd(ws)], { FAKE_MUTATE: '1' })
    expect(p2.ok).toBe(true)
    const snap = JSON.parse(readFileSync(ws.cache, 'utf8'))
    expect(snap.plugins.find((x: { id: string }) => x.id === 'dsh-rules-paths').installed).toBe(false)
  })
  it('refuses to run without a snapshot or without targets', () => {
    const ws = tracked(workspace())
    const p = runEngine(ws, ['apply', 'install', '1', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest])
    expect(p.ok).toBe(false)
    expect(p.errors[0]).toContain('snapshot missing')
    const p2 = runEngine(ws, ['apply', 'install', '--reff', ws.reff, '--cache', ws.cache, '--manifest', ws.manifest])
    expect(p2.ok).toBe(false)
  })
})

function existsSyncMaybe(p: string) {
  try { return readFileSync(p, 'utf8') !== undefined } catch { return false }
}
