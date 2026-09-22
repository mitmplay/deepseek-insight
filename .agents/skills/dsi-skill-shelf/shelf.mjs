#!/usr/bin/env node
// dsi-skill-shelf engine — The Skill Shelf (ADR 2026-09-20, D1-D6)
// Plain Node ESM, no dependencies. All output is JSON on stdout: { v: 1, ok, ... }

import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

const CACHE_VERSION = 1
const SIGNATURE_NAME = '.dsi-provenance.json'
const UNSTABLE_TIERS = new Set(['in-progress', 'deprecated'])
// locales the shelf can voice (mirrors project.inlang settings.json)
const SHELF_LOCALES = ['en', 'zh', 'id', 'es']

// tier display order (ADR D6: in-progress is last, numbers 2.30-2.38)
const TIER_RANK = { engineering: 0, productivity: 1, misc: 2, 'in-progress': 3 }
function tierSortKey(sk) { return (sk.tier !== null && sk.tier in TIER_RANK ? TIER_RANK[sk.tier] : 0) + ':' + sk.path }

// source name -> UPSTREAM OVERRIDE (2026-09-21 redesign: the SKR is the
// registry — every github source enumerates from its own URL by default;
// a row here only OVERRIDES the derivation, e.g. pstack's nested layout).
// single: true (2026-09-22) = the repo hosts exactly ONE skill at its
// canonical root (prefix 'skill', entry SKILL.md or SKILL.src.md; the id
// comes from the frontmatter name). impeccable ships one skill mirrored
// into ~20 host dirs — prefixless enumeration would yield duplicate rows.
const SOURCE_SPECS = {
  pstack:        { repo: 'cursor/plugins',    prefix: 'pstack/skills', tiered: false },
  mattpocock:    { repo: 'mattpocock/skills', prefix: 'skills',        tiered: true  },
  superpowers:   { repo: 'obra/superpowers',  prefix: 'skills',        tiered: false },
  'web-quality-skills': { repo: 'addyosmani/web-quality-skills', prefix: 'skills', tiered: false },
  impeccable:    { repo: 'pbakaus/impeccable', prefix: 'skill',        tiered: false, single: true }
}

// Derive the enumeration spec from the SKR line itself: the github URL
// names the repo, an optional tail hints the prefix — either the classic
// /tree/<branch>/<path> or (2026-09-22, single-skill repos) a bare path
// like .../repo/skill. A prefix that IS 'skill' or ends in '/skill'
// marks single-skill mode. SOURCE_SPECS wins when a row exists.
const SINGLE_SKILL_RE = /(^|\/)skill$/
function specFor(src) {
  if (SOURCE_SPECS[src.name]) return SOURCE_SPECS[src.name]
  // src.url = the raw SKR line; src.repo = a snapshot source (skrRepo's
  // output). Both carry a github URL the regex can read.
  const url = src.url || src.repo || ''
  const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/[^/]+(?:\/(.*))?|\/(.+))?$/)
  if (!m) return null
  const prefix = m[3] || m[4] || ''
  return { repo: m[1] + '/' + m[2], prefix, tiered: false, single: SINGLE_SKILL_RE.test(prefix) }
}

// Skill entry files the shelf can enumerate (2026-09-22): the classic
// SKILL.md and the single-skill repos' authored SKILL.src.md.
const ENTRY_FILES = ['SKILL.md', 'SKILL.src.md']
function frontmatterName(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const m = fm && fm[1].match(/^name:\s*(.+)$/m)
  return m ? m[1].trim() : null
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--reload') args.reload = true
    else if (a === '--allow-unstable') args.allowUnstable = true
    else if (a === '--force') args.force = true
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i]
    else args._.push(a)
  }
  return args
}

function fail(errors) {
  console.log(JSON.stringify({ v: CACHE_VERSION, ok: false, errors }))
  process.exit(1)
}

// --- SKR parsing (ADR D2: [name](repo-url) - [author](linkedin)) ---
export function parseSkr(text) {
  const sources = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\d+\.\s*\[(.+?)\]\((.+?)\)\s*-\s*\[(.+?)\]\((.+)\)\s*$/)
    if (!m) continue
    const name = m[1].trim().toLowerCase()
    sources.push({ name, url: m[2].trim(), author: m[3].trim(), repo: SOURCE_SPECS[name] ? SOURCE_SPECS[name].repo : null })
  }
  return sources
}

// --- enumeration ---

function walkLocal(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) walk(p)
      else if (entry === 'SKILL.md') out.push(dirname(p))
    }
  }
  walk(root)
  return out
}

function enumLocal(src, fixtureRoot) {
  // fixture tree mirrors the upstream layout under <fixtureRoot>/<sourceName>/
  const spec = specFor(src)
  const root = join(fixtureRoot, src.name)
  if (!spec || !existsSync(root)) return []
  if (spec.single) {
    // Single-skill repo: one entry at <prefix>/, id from the frontmatter
    // name (falls back to the folder name when the entry carries none).
    const dir = join(root, spec.prefix)
    const entry = ENTRY_FILES.find((f) => existsSync(join(dir, f)))
    if (!entry) return []
    let id = basename(spec.prefix)
    try { id = frontmatterName(readFileSync(join(dir, entry), 'utf8')) || id } catch { /* keep folder name */ }
    return [{ id, path: spec.prefix, tier: null, entry }]
  }
  const prefix = spec.prefix
  const tiered = spec.tiered
  const skills = walkLocal(root).map((dir) => {
    const rel = dir.slice(root.length + sep.length)
    const parts = rel.split(sep)
    const id = parts[parts.length - 1]
    let tier = null
    if (tiered && parts.length > 2) tier = parts[1]
    else if (tiered && parts.length === 2) tier = parts[0]
    return { id, path: rel, tier: tier && UNSTABLE_TIERS.has(tier) ? tier : null }
  })
  skills.sort((a, b) => tierSortKey(a).localeCompare(tierSortKey(b)))
  return skills
}

// GitHub API auth (2026-09-22): unauthenticated api.github.com allows
// only 60 req/hr per IP — one exhausted window aborts the whole refresh
// (observed: HTTP 403 on cursor/plugins). Prefer GITHUB_TOKEN / GH_TOKEN
// or the gh CLI credential when present (5000 req/hr).
let ghTokenMemo
function ghAuthHeaders() {
  const headers = { 'user-agent': 'dsi-skill-shelf' }
  let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
  // Once per process: spawning the gh CLI on every fetch both slows batch
  // enumeration and can hang a sandboxed run when gh is present but wedged.
  // DSI_SHELF_NO_GH=1 opts out entirely (unit tests, sandboxes).
  if (!token && !process.env.DSI_SHELF_NO_GH) {
    if (ghTokenMemo === undefined) {
      try { ghTokenMemo = execFileSync('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim() } catch { ghTokenMemo = '' }
    }
    token = ghTokenMemo
  }
  if (token) headers.authorization = 'Bearer ' + token
  return headers
}

// One trees call per source; failure is DATA ({ skills: [], error }),
// never an exception — one dead source must not abort the whole snapshot.
async function fetchTree(repo) {
  try {
    const res = await fetch('https://api.github.com/repos/' + repo + '/git/trees/HEAD?recursive=1', { headers: ghAuthHeaders() })
    if (!res.ok) {
      const hint = res.status === 403 ? ' (api.github.com rate limited? set GITHUB_TOKEN or run: gh auth login)' : ''
      return { tree: null, error: 'github trees ' + repo + ' -> HTTP ' + res.status + hint }
    }
    return { tree: (await res.json()).tree || [], error: null }
  } catch (e) {
    return { tree: null, error: 'github trees ' + repo + ' -> ' + String(e.message || e) }
  }
}

async function enumGitHub(src) {
  const spec = specFor(src)
  if (!spec) return { skills: [], error: null }
  const repo = spec.repo
  if (spec.single) {
    // Single-skill repo (2026-09-22): exactly one skill at <prefix>/, so
    // pick the entry file directly instead of scanning every SKILL.md
    // blob (impeccable mirrors its one skill into ~20 host dirs — a tree
    // scan would enumerate duplicates). The id is the frontmatter name.
    const { tree, error } = await fetchTree(repo)
    if (error) return { skills: [], error }
    const entry = ENTRY_FILES.find((f) => tree.some((n) => n.type === 'blob' && n.path === spec.prefix + '/' + f))
    if (!entry) return { skills: [], error: null }
    let id = basename(spec.prefix)
    try {
      const raw = await fetch('https://raw.githubusercontent.com/' + repo + '/HEAD/' + spec.prefix + '/' + entry, { headers: { 'user-agent': 'dsi-skill-shelf' } })
      if (raw.ok) id = frontmatterName(await raw.text()) || id
    } catch { /* keep folder name */ }
    return { skills: [{ id, path: spec.prefix, tier: null, entry }], error: null }
  }
  const { tree, error } = await fetchTree(repo)
  if (error) return { skills: [], error }
  const skills = []
  for (const node of tree) {
    if (node.type !== 'blob') continue
    const parts = node.path.split('/')
    if (!ENTRY_FILES.includes(parts[parts.length - 1])) continue
    if (spec.prefix && !node.path.startsWith(spec.prefix + '/')) continue
    const dirParts = parts.slice(0, -1)
    const id = dirParts[dirParts.length - 1]
    if (!id || id === 'deprecated') continue
    let tier = null
    if (spec.tiered && dirParts.length > 2) tier = dirParts[1]
    else if (spec.tiered && dirParts.length === 2) tier = dirParts[0]
    skills.push({ id, path: dirParts.join('/'), tier: tier && UNSTABLE_TIERS.has(tier) ? tier : null })
  }
  skills.sort((a, b) => tierSortKey(a).localeCompare(tierSortKey(b)))
  return { skills, error: null }
}

// --- signatures / reconciliation (ADR D5: signature is the uninstall authority) ---

export function readSignatures(skillsDir) {
  const signed = new Map()
  if (!existsSync(skillsDir)) return signed
  for (const entry of readdirSync(skillsDir)) {
    const sigPath = join(skillsDir, entry, SIGNATURE_NAME)
    if (!existsSync(sigPath)) continue
    try {
      const sig = JSON.parse(readFileSync(sigPath, 'utf8'))
      if (sig && sig.skillId === entry && sig.v === CACHE_VERSION) signed.set(entry, sig)
    } catch { /* unreadable signature is not authority */ }
  }
  return signed
}

// Skill overview (card UI, 2026-09-22): prefer the SKILL.md
// frontmatter `description:` line, else the first paragraph under an
// `## Overview` heading. Installed skills read from disk; uninstalled
// ones fetch the raw SKILL.md from the source repo (raw.githubusercontent
// is outside the API rate limit) so the card never lies about a missing
// overview. Parse failure still yields null — the honest fallback.
const OVERVIEW_MAX = 280
function parseOverview(text) {
  let out = null
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (fm) {
    const desc = fm[1].match(/^description:\s*(.+)$/m)
    if (desc) out = desc[1].trim()
  }
  if (!out) {
    const ov = text.match(/^##\s*Overview\s*\r?\n([\s\S]*?)(?=\n##\s|$)/m)
    if (ov) out = ov[1].trim()
  }
  if (!out) return null
  return out.length > OVERVIEW_MAX ? out.slice(0, OVERVIEW_MAX - 1).trimEnd() + '\u2026' : out
}
function readOverview(skillsDir, id, entry) {
  const files = entry ? [entry] : ENTRY_FILES
  for (const f of files) {
    const mdPath = join(skillsDir, id, f)
    if (!existsSync(mdPath)) continue
    try {
      return parseOverview(readFileSync(mdPath, 'utf8'))
    } catch { return null }
  }
  return null
}
async function fetchOverview(repo, relPath, entry) {
  const files = entry ? [entry] : ENTRY_FILES
  for (const f of files) {
    try {
      const res = await fetch('https://raw.githubusercontent.com/' + repo + '/HEAD/' + relPath + '/' + f, { headers: { 'user-agent': 'dsi-skill-shelf' } })
      if (!res.ok) continue
      const out = parseOverview(await res.text())
      if (out) return out
    } catch {
      // A thrown fetch (network down / connection refused) will not improve
      // for the next entry file — stop instead of hammering the endpoint.
      // HTTP non-ok still falls through to the next entry file.
      return null
    }
  }
  return null
}

async function buildSnapshot(sourcesRaw, enums, skillsDir, fixtureRoot) {
  const signed = readSignatures(skillsDir)
  const generatedAt = new Date().toISOString()
  const warnings = []
  const sources = []
  for (let si = 0; si < sourcesRaw.length; si++) { const src = sourcesRaw[si]
    // Registry-gap warning (2026-09-21, revised): enumeration derives
    // from the SKR URL itself, so an empty list is a REAL anomaly and
    // the snapshot says why.
    const spec = specFor(src)
    const enumed = enums[si] || { skills: [], error: null }
    if (!spec) {
      warnings.push({ code: 'source-no-repo', source: src.name, detail: 'source "' + src.name + '" has no github repo URL in the SKR - cannot enumerate' })
    } else if (enumed.error) {
      // Enumeration failure (rate limit, network) degrades to a warning —
      // the rest of the shelf still lands in the snapshot (2026-09-22).
      warnings.push({ code: 'source-enum-failed', source: src.name, detail: enumed.error })
    } else if (enumed.skills.length === 0) {
      warnings.push({ code: 'source-empty', source: src.name, detail: 'source "' + src.name + '" enumerated zero skills' + (spec.prefix ? ' under prefix "' + spec.prefix + '"' : '') + ' - upstream layout may have moved' })
    }
    const skills = []
    for (let ki = 0; ki < enumed.skills.length; ki++) {
      const sk = enumed.skills[ki]
      const installed = existsSync(join(skillsDir, sk.id))
      // Overview: disk first, then the source repo's raw SKILL.md for
      // uninstalled rows (sequential — gentle on raw.githubusercontent).
      let overview = readOverview(skillsDir, sk.id, sk.entry)
      // Fixture-root mode (unit tests) enumerates from disk only — a
      // per-skill raw.githubusercontent fetch here fired ~100 requests per
      // refresh (mock explosion). Overview stays null; live mode unaffected.
      if (!overview && spec && !fixtureRoot) overview = await fetchOverview(spec.repo, sk.path, sk.entry)
      skills.push({
        n: (si + 1) + '.' + (ki + 1),
        id: sk.id,
        path: sk.path,
        tier: sk.tier,
        installed,
        signed: signed.has(sk.id),
        installedFrom: signed.has(sk.id) ? signed.get(sk.id).source : null,
        overview
      })
    }
    sources.push({ id: src.name, name: src.name, author: src.author, repo: skrRepo(src), skills })
  }
  return { v: CACHE_VERSION, generatedAt, sources, warnings }
}

function skrRepo(src) {
  const spec = specFor(src)
  return spec ? 'https://github.com/' + spec.repo + (spec.prefix ? '/tree/main/' + spec.prefix : '') : src.url
}

// --- refresh ---

async function cmdRefresh(args) {
  const skrPath = resolve(args.skr || join(homedir(), '.dsi/resources/skills-reff.md'))
  const cachePath = resolve(args.cache || join(homedir(), '.dsi/resources/skr-cache.json'))
  const skillsDir = resolve(args['skills-dir'] || join(homedir(), '.agents/skills'))
  if (!args.reload && existsSync(cachePath)) {
    return { snapshot: JSON.parse(readFileSync(cachePath, 'utf8')), reused: true }
  }
  const sourcesRaw = parseSkr(readFileSync(skrPath, 'utf8'))
  if (sourcesRaw.length === 0) fail(['SKR parsed to zero sources: ' + skrPath])
  const fixtureRoot = args['fixture-root'] ? resolve(args['fixture-root']) : null
  const enums = []
  for (const src of sourcesRaw) {
    enums.push(fixtureRoot ? { skills: enumLocal(src, fixtureRoot), error: null } : await enumGitHub(src))
  }
  const snapshot = await buildSnapshot(sourcesRaw, enums, skillsDir, fixtureRoot)
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, JSON.stringify(snapshot, null, 2))
  return { snapshot, reused: false }
}

// --- signed apply (ADR D4 + D5) ---

function findSkill(snapshot, n) {
  for (const src of snapshot.sources) {
    const sk = src.skills.find((s) => s.n === n || s.id === n)
    if (sk) return { source: src, skill: sk }
  }
  return null
}

function copyDirLocal(fixtureRoot, sourceName, relPath, dest) {
  const srcDir = join(fixtureRoot, sourceName, relPath)
  if (!existsSync(srcDir)) throw new Error('fixture skill dir missing: ' + srcDir)
  cpSync(srcDir, dest, { recursive: true })
}

function copyDirGitHub(source, relPath, dest) {
  const spec = specFor(source)
  if (!spec) throw new Error('source "' + source.id + '" has no github repo URL - cannot install')
  const tmp = mkdtempSync(join(tmpdir(), 'shelf-clone-'))
  try {
    execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', 'https://github.com/' + spec.repo, tmp], { stdio: 'pipe' })
    execFileSync('git', ['-C', tmp, 'sparse-checkout', 'set', relPath], { stdio: 'pipe' })
    const srcDir = join(tmp, relPath)
    if (!existsSync(srcDir)) throw new Error('upstream skill dir missing after clone: ' + relPath)
    cpSync(srcDir, dest, { recursive: true })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function hashSkillFile(skillDir) {
  // Single-skill repos author SKILL.src.md (2026-09-22): hash whichever
  // entry file the installed skill actually carries.
  const entry = ENTRY_FILES.find((f) => existsSync(join(skillDir, f)))
  if (!entry) throw new Error('no SKILL.md / SKILL.src.md in installed skill dir: ' + skillDir)
  return 'sha256:' + createHash('sha256').update(readFileSync(join(skillDir, entry))).digest('hex')
}

async function cmdApply(args) {
  // args._ still carries the 'apply' command token from main()
  const action = args._[1]
  const targets = args._.slice(2)
  const cachePath = resolve(args.cache || join(homedir(), '.dsi/resources/skr-cache.json'))
  const skillsDir = resolve(args['skills-dir'] || join(homedir(), '.agents/skills'))
  if (targets.length === 0) return fail(['apply ' + action + ' needs at least one target'])
  if (!existsSync(cachePath)) return fail(['snapshot missing, run refresh first: ' + cachePath])
  const snapshot = JSON.parse(readFileSync(cachePath, 'utf8'))
  const results = []
  if (action === 'install') {
    const fixtureRoot = args['fixture-root'] ? resolve(args['fixture-root']) : null
    for (const n of targets) {
      const hit = findSkill(snapshot, n)
      if (!hit) { results.push({ n, ok: false, error: 'not on shelf: ' + n }); continue }
      const { source, skill } = hit
      if (skill.tier && UNSTABLE_TIERS.has(skill.tier) && !args.allowUnstable) {
        results.push({ n, id: skill.id, ok: false, error: 'unstable tier (' + skill.tier + ') requires --allow-unstable' })
        continue
      }
      const dest = join(skillsDir, skill.id)
      if (existsSync(dest) && !args.force) {
        results.push({ n, id: skill.id, ok: false, error: 'collision at ' + dest + ' (use --force)' })
        continue
      }
      mkdirSync(skillsDir, { recursive: true })
      try {
        if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
        if (fixtureRoot) copyDirLocal(fixtureRoot, source.id, skill.path, dest)
        else copyDirGitHub(source, skill.path, dest)
        // Single-skill repos author SKILL.src.md (2026-09-22), but the
        // DSH host skill provider only scans SKILL.md — without it the
        // skill installs fine yet never appears in the host catalog and
        // cannot be invoked. Materialize SKILL.md from the authored src.
        const mdPath = join(dest, 'SKILL.md')
        if (!existsSync(mdPath) && existsSync(join(dest, 'SKILL.src.md'))) {
          copyFileSync(join(dest, 'SKILL.src.md'), mdPath)
        }
        const sig = {
          v: CACHE_VERSION, source: source.id, n: skill.n, skillId: skill.id,
          upstreamPath: source.id + '/' + skill.path,
          installedAt: new Date().toISOString(),
          contentHash: hashSkillFile(dest)
        }
        writeFileSync(join(dest, SIGNATURE_NAME), JSON.stringify(sig, null, 2))
        // Voice sidecars (The Shelf Voice ADR D3/D4): .dsi-voice/<locale>.json
        // travels with the skill. en is an ALWAYS-written scaffold; operator
        // locales come from the --voice JSON payload authored by the
        // installing agent. An invalid payload NEVER blocks the install -
        // it degrades to en-only (D4) and says so on the result item.
        let voiceError = null
        const voice = { en: { name: skill.id, description: '', whenToUse: '' } }
        if (args.voice) {
          try {
            const payload = JSON.parse(args.voice)
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('voice payload must be an object')
            for (const [loc, entry] of Object.entries(payload)) {
              if (!SHELF_LOCALES.includes(loc)) throw new Error('unsupported locale: ' + loc)
              if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name.trim() || typeof entry.description !== 'string') throw new Error('bad voice entry for ' + loc)
              voice[loc] = { name: entry.name, description: entry.description, whenToUse: String(entry.whenToUse ?? '') }
            }
          } catch (e) {
            voiceError = String(e.message || e)
          }
        }
        const voiceDir = join(dest, '.dsi-voice')
        mkdirSync(voiceDir, { recursive: true })
        for (const [loc, entry] of Object.entries(voice)) {
          writeFileSync(join(voiceDir, loc + '.json'), JSON.stringify({ v: CACHE_VERSION, ...entry }, null, 2))
        }
        results.push({ n, id: skill.id, ok: true, installed: true, voice: Object.keys(voice), ...(voiceError ? { voiceError } : {}) })
      } catch (e) {
        rmSync(dest, { recursive: true, force: true }) // D4: no folder without signature
        results.push({ n, id: skill.id, ok: false, error: String(e.message || e) })
      }
    }
  }
  else if (action === 'uninstall') {
    for (const id of targets) {
      const dir = join(skillsDir, id)
      const sigPath = join(dir, SIGNATURE_NAME)
      if (!existsSync(dir)) { results.push({ id, ok: false, error: 'not installed: ' + id }); continue }
      if (!existsSync(sigPath)) { results.push({ id, ok: false, error: 'unsigned - not uninstallable via shelf (D5)' }); continue }
      try {
        const sig = JSON.parse(readFileSync(sigPath, 'utf8'))
        if (sig.skillId !== id) { results.push({ id, ok: false, error: 'signature id mismatch' }); continue }
        rmSync(dir, { recursive: true, force: true })
        results.push({ id, ok: true, uninstalled: true })
      } catch (e) {
        results.push({ id, ok: false, error: String(e.message || e) })
      }
    }
  } else {
    return fail(['unknown apply action: ' + action])
  }
  // Flip the snapshot flags for successful results (ADR sequence step:
  // "flip installed / installedFrom") - without this the panel's next
  // refetch shows stale state and the uninstall affordance never appears.
  if (results.some((r) => r.ok)) {
    for (const r of results) {
      if (!r.ok) continue
      for (const src of snapshot.sources) {
        const sk = src.skills.find((s) => s.id === (r.id ?? ''))
        if (!sk) continue
        if (action === 'install') { sk.installed = true; sk.signed = true; sk.installedFrom = src.id }
        else { sk.installed = false; sk.signed = false; sk.installedFrom = null }
      }
    }
    writeFileSync(cachePath, JSON.stringify(snapshot, null, 2))
  }
  const ok = results.every((r) => r.ok)
  return { ok, results }
}

// --- main ---

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]
  if (command === 'refresh') {
    const { snapshot, reused } = await cmdRefresh(args)
    console.log(JSON.stringify({ v: CACHE_VERSION, ok: true, reused, snapshot }))
  } else if (command === 'apply') {
    const out = await cmdApply(args)
    console.log(JSON.stringify({ v: CACHE_VERSION, ...out }))
  } else if (command === 'snapshot-status') {
    const cachePath = resolve(args.cache || join(homedir(), '.dsi/resources/skr-cache.json'))
    console.log(JSON.stringify({ v: CACHE_VERSION, ok: true, present: existsSync(cachePath), path: cachePath }))
  } else {
    fail(['unknown command: ' + command + ' (use refresh | apply | snapshot-status)'])
  }
}

main().catch((e) => fail([String(e && e.stack || e)]))
