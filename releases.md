# Releases

## v0.6.6

Bumped from v0.6.5 — the Skill Shelf learns duplicate-id discipline: one id, one row, one folder, with an honest one-line warning when a source ships the same skill twice.

### Features

- **Duplicate-id dedupe in the shelf snapshot** (ea9eb3c, feat pair f214f06/49c1889) — when a source lists the same skill id at multiple paths (open-design shipping `blog-post` under two trees), the snapshot collapses to the canonical `skills/<id>` row, marks the kept row with the `(d)` shelf marker (`SettingsSkillsItem`), and emits a `source-duplicate-id` warning. The warning stays one line per source (162fdb9 — a 100-drop source no longer buries the shelf) and the panel prints the detail verbatim. Grounded in the open-design BUG analysis (2026-10-05): same-title cross-listed frames are distinct features (generate-from-spec vs bundled render), so only true id collisions dedupe. Tests: tests/unit/skill-shelf/dedupe.test.ts.

### Bug fixes

- **Apply flips every row sharing an id — ghost twins** (ec912b7) — toggling one row of a duplicate-id pair left its sibling stale in the UI; apply now flips every row sharing the id so the shelf never shows a ghost state. Tests: skill-shelf apply suite.
- **Uninstall of a vanished installed folder reconciles** (cf8316c) — uninstalling a skill whose installed folder was already deleted deadlocked the reconciliation; it now reconciles the signature bookkeeping and reports honestly instead. Tests: skill-shelf roundtrip suite.
- **Harvest progress sidecar restored** (21ad689, after revert b0b8ed0 and re-land ea9eb3c) — the repo-external engine move dropped the refresh progress sidecar; restored and pinned by tests/unit/skill-shelf/progress-sidecar.test.ts before the dedupe feature re-landed on top.

### Housekeeping

- Skills reference material moves to the parent folder (2b026bc) with reference paths updated (49606cd).

## v0.6.5

Bumped from v0.6.4 — the composer's shelf finder learns to answer mid-draft and markdown documents keep their cards after an update.

### Features

- **The Line Trigger** (e960f19, ADR-0014) — the composer's `?` shelf finder fires at the start of ANY line, not only line one, so boilerplate can be pulled from the shelf below typed prose (`?adr, spec + task`); the term splitter accepts `,` and `+` alongside `;` and whitespace, client and server in lockstep. Run mode (`!`) stays draft-scoped by design. Tests: tests/unit/prompt-trigger.test.ts (ADR-0014 describe), tests/unit/prompts-db.test.ts (widened parity fixture).
- **The Markdown Cards** (b1bb0b6, ADR-0013) — inside the expanded FilesEditedCard, created markdown renders first as a two-per-row card grid (MD badge, basename, directory, counts) before the flat list; clicking opens the file through the transcript's file-link pipeline. Tests: tests/unit/files-edited-card.test.ts.

### Bug fixes

- **Updated markdown keeps its card — The Updated Markdown Incident** (67fa90b, ADR-0013 v2) — the original `deleted === 0` heuristic dropped a markdown file from the card grid on any turn that edited it after creation, burying the most recently changed document in the flat list. Amended rule: a card is a `.md` path with a real content change (added > 0 OR deleted > 0); the card now shows symmetric +/− count chips. Tests: the "UPDATED markdown rides the grid too" / "pure-deletion markdown" / "metadata-only" block in tests/unit/files-edited-card.test.ts (shown red before the fix).

## v0.6.4

Bumped from v0.6.3 — the turn-usage surface stops under-counting: the provider's exact total becomes the headline and the detail rows always sum to it (The Exact Total, ADR-0012).

### Features

- **Turn usage trusts the provider's exact total** (24ff847, ADR-0012 D1) — the token-usage shape carries the wire totalTokens (safe positive counts, copied verbatim, never synthesized), turnUsage() aggregates it all-or-nothing (D3), and the pill + popup headline show it; the bucket sum stays as the fallback. Fixes a 48% under-count against DSH's own pill on providers that fold cached input into the total without a cache bucket (zai/glm-5.3-flash: 11,507 shown vs 22,259 billed). Tests: tests/unit/dsh-events-usage.test.ts and the turn-grouping "the exact total" block.
- **Implied cached-input row** (24ff847, ADR-0012 D2) — when the provider's cache bucket is absent, the popup derives the unitemized remainder (total minus output minus input minus cache-write) as a marked "~ implied" row, so detail rows sum exactly to the headline; copy localized across en/zh/id/es with the parity gate (messages-parity.test.ts). Tests: tests/unit/turn-usage-panel.test.ts (three display shapes).

### Bug fixes

- **Usage pill double-count corrected** (24ff847) — a turn whose cache buckets overlapped the prompt total previously showed the bucket sum (10,479 for a 5,479-token turn); the pinned expectation in chat-components.test.ts was updated with the fix.

### Housekeeping

- dsh pin moves to 0.2.1-alpha.1 (package.json webVersion, 827add2); the DSH jump impact analysis lives in ADR-0012 section 2 fact 8: no host-side usage-accounting change in the jump.
- Spec discipline note: ADR-0012 shipped with its full spec set (PRD, Tasks.md, Tasks.json twin, karpathy-context) under dev/specs/2026-10/.

## v0.6.3

Bumped from v0.6.2 — the synced pair survives a busy 3080, first-run npx downloads are no longer silent, and the dsh pin moves to 0.2.0-rc.1.

### Features

- **`dsi dsh --port <n>` forwards to the host half** (a5d5b5b) — when 3080 is held by a `dsh web` this CLI does not own (another live conversation floor), the preflight no longer kills it; the forwarded flag goes to `dsh web` untouched and DSI follows via `DSH_BASE_URL`, so the page dials the host wherever it landed (`bin/dsi.mjs` `hostPortFromArgs`, `runSyncedPair`).
- **First-run npx download heads-up** (a5d5b5b) — a new pinned dsh installs for minutes with zero output when piped through the token watcher; the CLI now probes the `_npx` cache (`dshPackageCached`) and prints a heads-up before spawning the host.
- **dsh pin 0.1.7-rc.2 → 0.2.0-rc.1** (a5d5b5b, `package.json`) — the Model Gate release; impact analysis in `dev/kb/releases/2026-09-29`.

### Bug fixes

- **Orphan detection covers the npx-published launch** (a5d5b5b) — the real argv shape is `node …/_npx/<hash>/node_modules/.bin/dsh web`, matched by neither `lib/bin.js` nor the npx shims pattern; a new orphan pattern stops the preflight from restarting over it.
- **Prompt textarea refocus after a tag-chip toggle** (a5c3f04) — toggling a tag chip stole focus from the prompt; the strip refocuses the textarea.

### Housekeeping

- File editor host scaled down to zoom 0.85 (ee4d7e1); Model Gate release notes added under `dev/kb/releases/`.

## v0.6.2

Bumped from v0.6.1 — the plugin rack survives duplicate catalog ids and the resource shelves are refreshed.

### Bug fixes

- **Duplicate catalog ids no longer crash the rack** (eff3e4f) — the catalog can list two distinct plugins under one id (e.g. `dsh-deepresearch` by omdsh-dev and havingautism), and keying rows by `plugin.id` threw `each_key_duplicate`; rows now key by the engine row number `plugin.n`, pinned by the duplicate-id regression test in `tests/unit/plugin-rack-panel.test.ts`.
- **Tighter rack rows** — rack-row vertical padding trimmed (0.3rem → 0.12rem) so the numbered list scans cleanly.

### Housekeeping

- `plugins-reff.md` and `skills-reff.md` refreshed: sequential numbering, a new `open-design` skill entry, and the plugins shelf trimmed to the installed pick (`dsh-agent-teams`).

## v0.6.1

Bumped from v0.6.0 — the Plugin Rack bounce is fixed for real and the rack reads like a list.

### Features

- **Busy verbs spin, the panel rides the bounce by itself** (dc69965) — a running plugin verb shows a spinner on its rack row and the panel auto-follows a restart bounce instead of needing a manual refresh; stale i18n keys dropped from all four catalogs (en/es/id/zh), pinned by `plugin-rack-panel.test.ts`, `restart-chain.test.ts` and `plugin-i18n-parity.test.ts`.
- **Rack rows number like a list** (161ee8d) — rows render as `1.` `2.` `3.` with a snug gap, so the rack scans like an ordered list (`PluginManagerRackRow.svelte`).

### Bug fixes

- **The bounce comes back** (9501315) — the post-install restart had gone silent: pkill's pattern match missed the real listener, so the bounce now sweeps the port listener itself, restores dev-mode fidelity (the dev server restarts as dev, not prod), and writes a chain journal of every restart step; `restart-chain.test.ts` grew 57 lines of regression pins.
- **Bounce detects the dev floor in the process table, not the env** (26fe77d) — dev detection read an env var the relaunched process never had; `bin/dsi.mjs` + `bin/lib/plugin-chain.mjs` now find the dev floor by inspecting the process table, pinned in `dsi-plugin-chain.test.ts`.
- **Reload verb rebuilds the snapshot** (8958275) — reload re-read a stale cache, showing pre-reload rows; the verb now rebuilds the snapshot from disk and `plugin-rack-panel.test.ts` pins it. `plugins-reff.md` updated to match.

### Housekeeping

- Stray `tmp/commit-msg.txt` scratch file dropped (642b396).

## v0.6.0

Bumped from v0.5.38 — The Plugin Rack wave: plugins install through dsh and restart through dsi, `/dsi-plugins` joins the slash menu, and markdown grows real external links.

### Features

- **The Plugin Rack (W1–W4)** (0381eb0, 4ccc5ad, 9e03af1, e22eaa3, 50ebc7d; ADR 2026-09-27) — plugins become a managed shelf: a rack engine (`rack.mjs` + `src/lib/server/plugins/engine.ts`) owns install/uninstall with the manifest as the uninstall authority (D4); `/api/plugins/{apply,reload,snapshot}` wire it to the wire; `/dsi-plugins` joins the slash menu and command help (abbf5b4); the PluginManagerPanel gives the rack a two-tab chrome — install vs uninstall — with per-row state, snapshot/search/capture toolbar (92a4e2f), rows opening the repo and creator profile (885330d), and a hard-reload-surviving active tab (1c723cc). Proven by `plugin-rack-engine.test.ts`, `plugin-rack-macro.test.ts`, `plugin-rack-panel.test.ts`, `plugin-rack-panel-edges.test.ts`, `api-plugins-*.test.ts`, `dsi-plugin-chain.test.ts`, `plugin-i18n-parity.test.ts`.
- **Skill shelf reorganization** (6da530a, 58dbed5, 92f4b12) — the skills panel splits into Header/Actions/Tabs components on the shelf-chrome pattern, renamed to the SettingsSkills* family.
- **Bare-URL autolink + external host icons** (416f7e4) — a bare http(s) URL in any transcript renders as a hardened anchor: display text is origin+path, the href keeps the full query/hash, and every external link gains its host favicon (Google s2 service); pinned by six new cases in `markdown.test.ts`.
- **Whole-URL code spans render as links** (2251847) — a code span that is entirely one http(s) URL upgrades to the icon'd external link; code that merely contains a URL stays literal (tool-payload rule holds).
- **README filled out** (e7e1321) — plain-language paragraphs for autocomplete (`?`), macros (`!`), the prompt/plugin/skill managers, the multi-tab terminal, and the workspace explorer.

### Bug fixes

- **Slash-menu tests stale after the 9th gesture** (e93b519) — `pluginrack` (`/dsi-plugins `) joined `MENU_GESTURES` at index 5 without the tests following; the ladder, counts (8→9), `@mention` index and highlight offsets re-synced to the ADR D1 contract — 25/25 + 26/26 green, full suite 4,536.
- **Markdown angle-bracket destinations** (152aecb) — `[label](<path>)` destinations sanitize to bare paths instead of leaking the wrapper.
- **Favicon service reliability** (2251847) — DuckDuckGo's ip3 icon service (TLS failures, wrong marks) replaced with Google s2 favicons, verified returning the true GitLab mark.

### Housekeeping

- Coverage lifted to the 80% per-file floor across 8 files (fdee648); `api-plugins-reload-route` and `restart-chain` unit tests added (e5dfd90); committed tmp scratch files dropped (9e73db4, 401e1b1, 8a8f9c3, e4d74cf); intentional `state_referenced_locally` warnings silenced (f621a05).

## v0.5.38

Bumped from v0.5.37 — the Fullpath Bow file-link wave lands, the editor moves to monaco 0.57, and the workspace image preview is re-rooted on the local filesystem.

### Features

- **Fullpath Bow — file-link intents** (6895fdb, 5ee7c9a, aa4dbfb, d9238cd) — transcript file links resolve against the workspace root before the existence gate (tilde/unexpanded roots included), gain inline extension icons, and open intents reveal the deep explorer tree row (ADR 2026-09-26 D1–D3); proven by headed Playwright runs and operator regression tests.
- **monaco-editor 0.55.1 → 0.57.0** (554ed34) — dependency and pnpm override bumped; `monaco-worker-decls.d.ts` restores the esm worker entry typing 0.57 dropped; svelte-check identical to baseline, vitest and build green.

### Bug fixes

- **Workspace image previews broken** (4f22323) — the host's `readBytes` wire contract changed under the untouched route (range → options + multipart receipts, 0.1.7-rc.2), starving the `<img>`. The route now reads the workspace filesystem directly, contained to the root (.. walk → 403) — a read-only local GET never needed the RPC hop; regression-pinned by the rewritten `workspace-file-bytes-route.test.ts` (8 cases).
- **Git-watch double ring** (a765260) — stability confirmation collapses the FSEvents two-window double ring; one bump per git op.
- **35 svelte-check type errors** (29d113e) — all in test files (FakeES interface, self-referential mock editor, `it.each` typing, mount props); fixed with no test-intent change, verified error-list-identical on unrelated files.
- **Yaml worker console noise / crash** (9309afc, 1ff604b, 51a886f, 3bda4c2, 4cb94fd, 8f07f01) — the monaco-yaml worker boot race silences its `Missing requestHandler` noise, no-op base-feature providers stop doomed worker calls at the source, monaco 0.56's uncaught worker throws disable yaml validation, the 0.55.1 override restores full language services, and `.yaml/.yml` finally serves as plaintext editors (monaco-yaml protocol incompatible with installed monaco).
- **Unrenderable mermaid blocks** (6ac2685) — fence styles, a reserved Box alias, and lexer-hostile message text fixed; full parse sweep added.

## v0.5.37

Bumped from v0.5.36 — the chat → composer reorganization lands whole: source tree, tests, and dev-docs now agree on one component map.

### Features

- **File link raw-href seam** (addd926) — transcript file links open with the `#L` anchor line jump, user-bubble parity with assistant bubbles, and explorer highlight on open; manual-verify artifacts kept out of the repo (0f57020 keeps only the verify script).
- **dsi-bump-up skill** (9edadd8) — the vrelease ritual (version bump, releases.md section, commit+push, dsi-sync mirror) is now a repeatable skill instead of tribal memory.

### Bug fixes

- **File link dot-dot traversal probe** (f83adf6) — the dot-dot fast-fail now runs inside the existence gate, so direct traversal paths no longer fire a probe fetch.
- **Stale coverage excludes after the component moves** (5d37eef) — `vitest.config.ts` still excluded `composer/TokenCounter.svelte` and `composer/StripTagChips.svelte` at their pre-move paths, so the 80% per-file coverage floor silently re-measured files it was decided not to measure. Excludes now point at `composer/sibling/` and `composer/menu/suggest-strip/`.

### Refactoring

- **components/chat → components/composer** (3299ec3, 42311f3, e069d8e, ca25bff, de1c2e3) — the flat `chat/` namespace is gone: attachment components into `composer/attachment/`, SlashMenu + suggest-strip into `composer/menu/`, six sibling components into `composer/sibling/`, PromptInput renamed Composer; every importer updated.
- **The Test Mirror** (5d37eef, ADR 2026-09-26) — 134 component unit tests moved under `tests/unit/components/<area>/` mirroring the source subtree shape, per the new ADR; 193 service/route tests stay flat. Full suite 4,393 green under the coverage gate.
- **Coverage gaps closed** (03e1634) — every sub-80% coverage gap shut; full suite green under the 80% global per-file gate.
- **AccessModeConfirm extracted** (69b3ab7) — the risk gate lives in `access-mode/` with chip move + Composer wiring.

### Docs

- **Dev-doc stale-path audit** (21867bc) — 123 dev docs, 218 stale `components/chat` mentions rewritten to current locations; the audit record with the full mapping table lives at `dev/rename-audit-2026-09-26.md`.

## v0.5.36

Bumped from v0.5.35 — Add Workspace flow fixes.

### Bug fixes

- **Add workspace: stuck panel after a successful native pick** — after the OS
  folder dialog returned a path and the adopt+create succeeded, the panel's
  `done` step left the dialog rendered with a permanently disabled
  "Add workspace & start chat" button (in the native flow `listing` is null,
  so the confirm button could never enable). The panel now dismisses itself on
  full success; it reopens showing the error only if the navigation callback
  itself throws, so a failure is never silently swallowed. Regression test:
  "a successful native pick dismisses the panel (no stuck dialog)".
- **Add workspace: the new session ignored the selected Agent** — the create
  POST sent only `{ cwd }`, so the fresh session always landed on the host
  default agent even when an agent pill was selected in the SessionFilter row
  (the pill visible in SessionFilterHeader). The selected agent preset is now
  threaded through SessionFilterMeta into AddWorkspaceButton and rides the
  create (`{ cwd, agentPreset }`), matching NewChatButton's grammar. No pill
  selected still falls back to the host default. Regression test: "the armed
  agent rides the create — no silent default".

### Tests

- 2 new regression tests in `tests/unit/add-workspace-button.test.ts`
  (24 total, all passing).
