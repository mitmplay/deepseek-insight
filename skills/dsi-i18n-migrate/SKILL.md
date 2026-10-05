---
name: dsi-i18n-migrate
description: Use when UI copy in deepseek-insight needs migrating to the translation catalogs (new components, raw copy found by verify-ui-i18n, or a new locale being added) — enforces the t(m.x) reactive seat, en/zh/id catalog triples, brand skip-markers, and the full gate list. Delegatable to a subagent for bulk sweeps.
---

# DSI i18n Migration Standard

Make UI copy flow through the catalogs — never paste sentences into
components. This skill packages the procedure proven in waves 1–4 of the
Three Tongues (companion: ADR 2026-09-12 + KB `dev/kb/translation/`).

## 0. Ground rules (read first)

- The ONLY files owning copy are `messages/en.json`, `messages/zh.json`,
  `messages/id.json`. Components render via `t(m.key)`.
- `t` is the reactive seat from `$lib/services/locale/locale-state.svelte` —
  a bare `m.key()` reads no reactive state, so the label would freeze until
  reload. Never ship a bare `m.key()` in a template.
- Keys are flat camelCase, one per sentence/label; reuse an existing key when
  the English value is identical (check all three catalogs first).
- Catalog triples are written [en, zh, id] — en = the exact original string;
  zh = Simplified Chinese; id = Indonesian. Concise UI tone; keep proper nouns
  (DSH, DSI, Deepseek, Monaco) as-is; no trailing periods unless the original
  has one.
- Brand strings (`— deepseek-insight`, `DEEPSEEK INSIGHT`) are never
  translated: mark the flagged line's preceding line with `<!-- i18n-skip:
  brand -->` (same indentation) and skip.
- Dynamic literals become paraglide placeholders: catalog `"Delete {n} selected"`,
  call site `t(() => m.deleteSelected({ n: selected.size }))` (the deferred
  closure keeps the locale tracking alive).
- Native-language names (menu entries like 中文 / Bahasa Indonesia) are
  constants, NOT catalog keys — a language menu shows every name in its own
  language.

## 1. Inventory

Run `pnpm run verify-ui-i18n`. The scanner covers: raw text nodes,
copy-bearing attributes (title / aria-label / placeholder / *Label…), string
literals and template quasis inside template expressions, and {#if}
consequent/alternate blocks. Save the output (e.g. `/tmp/violations.txt`) —
it is the worklist; every line must end resolved, skip-marked, or explained.

Known scanner blind spots to check by hand: lowercase-only literals (e.g.
`answering…`) fail the natural-text heuristic; copy built in script sections
is invisible.

## 2. Migration

For each violation: replace the literal with `t(m.keyName)` /
`attr={t(m.keyName)}` / `t(() => m.key({ p }))`, add the missing imports
(`* as m from '$lib/paraglide/messages'`, `t` from the locale-state service —
note some components have no `<script>` block and need one created).
Idempotent exact-replacement scripts are fine for bulk sweeps (see
`scripts/migrate-w3.mjs` in git history for the shape); hand-edit for the
tricky sites (ternaries, `${}` fragments → split keys).

If the sweep is large (>20 files), delegate it to a subagent with this skill
attached, the inventory file path, and instruction to leave the tree
uncommitted; the parent verifies gates (step 4) before accepting.

## 3. Catalogs and recompile

Append the new keys to all three catalogs, then recompile:
`pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`
— or run `pnpm build`, which does the same through the vite plugin. Prefer the
plugin (vitest runs it too); never ship CLI-compiled output as the built
artifact (it resets cookieName — ADR D6).

## 4. Gates (all must pass)

1. `pnpm run verify-ui-i18n` → "verify-ui-i18n: clean"
2. `pnpm vitest run tests/unit/messages-parity.test.ts tests/unit/ui-i18n-clean.test.ts tests/unit/locale-instant-switch.test.ts` → green
3. `pnpm test` → only the known pre-existing `sessions-list.test.ts` failure
   allowed (document any new failure as yours and fix it)
4. `pnpm check` → zero diagnostics in files you touched
5. `pnpm build` → exit 0 (compiled runtime must carry cookieName `dsi.locale`)
6. `pnpm exec playwright test tests/e2e/locale.spec.ts` → green

Report: violations fixed, keys added, files touched, gate results, anything
skipped with reason.

## 5. Adding a locale (not just strings)

New language L = one `messages/L.json` (key-complete — the parity test
enforces it) + add L to `project.inlang/settings.json` locales + `UI_LOCALES`
in `src/lib/config.ts` + `localeName_L` native name + the locale pickers'
native-name constants. The ADR D6 compiled-truth rule applies unchanged.