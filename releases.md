# Releases

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
