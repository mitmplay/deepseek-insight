---
name: "dsi-spcheck"
description: "Verify feature-spec docs coherence: trace facts across Karpathy→PRD→Tasks, catch missing branches and field mismatches before execution.  Reserved keywords:"
---

# Spec Coherence Check

Verify that feature-spec deliverables are internally coherent and execution-ready.
Runs after `/feature-spec` produces docs, before `/execute-tasks` consumes them.

Reserved keywords: `/spec-check`, `/coherence-check`

## When to Use

- After `/feature-spec` has produced all 3 deliverables (karpathy-context.md, PRD.md, Tasks.md)
- Before handing off to `/execute-tasks`
- When reviewing a spec folder you didn't author
- When a spec "looks fine" but execution keeps hitting gaps

## Inputs

```
/spec-check {path-to-spec-folder}
```

If no path given, ask. The folder must contain all 3 files:
- `karpathy-context.md` (base layer — source of truth)
- `PRD.md` (supporting layer — derives from Karpathy)
- `Tasks.md` (execution layer — derives from both)

## Procedure

### Step 0: Load all 3 documents

Read all files. Store in context. Do not skip any.

### Step 1: Cross-Document Fact Trace

For each critical fact, verify it appears and is consistent across all docs that need it.

**Facts to trace (Karpathy → PRD → Tasks):**

1. **Module Map entries** — every module in Karpathy Layer 3 Q3 appears in PRD Module Map. Every file touched in Tasks references a module from the map.
2. **Shared Utilities** — every utility in Karpathy Shared Layer appears in PRD Shared Utilities Inventory. Every import in Tasks code snippets references a function that exists in the Shared Layer.
3. **Edge cases** — every edge case in Karpathy Layer 2 Q4 appears (or is explicitly deferred) in PRD Edge Cases and Tasks Risk Register.
4. **Off-limits files** — every file in Karpathy Q6 "off-limits" is NOT modified in any Tasks task. Grep Tasks for file paths and cross-reference.
5. **Module boundaries** — Karpathy boundary rules are respected by Tasks code snippets. No Tasks snippet imports from a forbidden path.
6. **Design decisions** — each Karpathy decision has a corresponding mention in PRD. If PRD adds decisions not in Karpathy, flag for back-propagation.
7. **Enumerated status/state vocabulary** — grep every status/state/type/kind string literal in Tasks code snippets and SQL queries. Read the schema `CREATE TABLE` status comment and the state-machine line in the source/architecture doc. Any value not in the declared set is a silent bug: non-enforced TEXT columns accept any string, so a sibling component's query (`WHERE status = 'running'`) silently misses rows stored under a different literal (`in_progress`). Trace each literal across every doc that touches it — including the architecture/source doc itself, which is often internally inconsistent (schema says one value, prose examples another).
8. **Cross-feature dependencies** — when a feature references modules defined in another feature's spec (look for cross-refs like "(F1)", "Feature N", or import paths into sibling spec folders), open the referenced feature's spec and verify each claim against its own Module Map and Tasks:
   - **Export location** — the consuming feature's import points to the file the defining feature actually names as the export site (e.g., F4 PRD says `describeInputError()` lives in `discovery.ts`; F1 spec places it in `permission.ts` — wrong path breaks every import).
   - **Import style** — if the consuming feature imports from a barrel (`./audio/index.js`), confirm the defining feature specifies a barrel `index.ts` and the codebase actually uses barrels (count `index.ts` under the target dir). Zero barrels + barrel import = compile failure or empty module.
   - **Signature contract** — the consuming feature calls the function with the arg count and return type the defining feature declares.
**Per-entity vocabularies:** a codebase may define different status sets per entity type (e.g. tasks: `running`; features/waves: `in_progress`). When a literal is valid for one entity but wrong for another, trace per-entity with context-scoped grep — never globally find-replace a bare literal or you corrupt the valid entity's references. To verify each remaining occurrence, read its surrounding sentence/row for the entity name before deciding to change it.

**Evidence requirement — avoid false-positive gaps.** Every Step 1 gap must cite verifiable evidence from the actual file: the quoted heading text or a `grep` count. Two recurring false positives:
- **"Section X is missing"** when it exists under another heading or section number. Read the full file and `grep` for the heading words before asserting absence.
- **"Doc references function Y"** that the doc never mentions. `grep` the doc for the symbol before claiming a reference.

A gap with no quoted source evidence is a false positive — do not report it.

### Step 2: Source-Code Reality Check

For each file the Tasks document instructs the executor to create or modify:

1. **Read the actual file** from disk.
2. **Verify field names** — Tasks code snippets use the same field names as the source. Flag mismatches.
3. **Verify render/processing chains** — if Tasks shows a BEFORE/AFTER diff, does the BEFORE match the actual current source? Missing branches = silent deletion risk.
4. **Verify function signatures** — Tasks snippets call functions with correct signature as the source.
5. **Check for undocumented branches** — if source has conditional branches that Tasks BEFORE/AFTER doesn't show, flag them. Executor might delete them.
6. **Verify target directories exist** — for each *new* file path in Tasks, `ls` its parent directory. If absent, the spec must instruct `mkdir -p` before file creation; otherwise every import of that path fails at compile time. Grep all import paths against the real tree before trusting them.
7. **Verify styling tokens match the project token system** — read `app.css` (or design-token source) for the actual CSS custom properties and utility classes the project uses. Flag generic framework defaults (e.g. `bg-green-500`, `text-red-500`) that don't map to project tokens (`text-status-pass`, `text-accent-blue`): same color name ≠ same hex value, so they silently break visual consistency.
8. **Verify code-structure pattern matches codebase convention** — when spec code snippets introduce a new module that has a structural analog in the existing codebase (another polling service, another reactive store, another API reader), read that analog and confirm the new code follows the same structural pattern (factory function vs class, lifecycle hook shape, module export style). A class where the codebase uses factory functions compiles fine but diverges from convention and creates maintenance friction. Fix in lockstep across all docs that show the snippet.

9. **Trace consumed fields through the whole chain** — for each field a Tasks/PRD UI snippet consumes, verify the full chain exists in source: DB column → query/SELECT → view-model interface → mapper function → prop reference. View-model mappers routinely drop columns, so a missing link compiles clean and the affordance silently never renders. Report a consumed field with no full chain as a MEDIUM gap; the fix is a task extending the chain (interface + mapper + one reader test) plus the map rows. **Done when** every field a snippet consumes traces column → SELECT → view-model → prop.

10. **Recompute exact computed literals asserted by Tasks** — when a Tasks unit assertion pins an exact string produced by arithmetic or framework interpolation (e.g. `width: {100 / zoom}%` → `105.26315789473685%`), never trust the digits in the doc: recompute with `node -e`. Floating-point last-digit drift (`…684` vs `…685`) is invisible to reading and fails the test on first run, tempting the executor to loosen the assertion. If serialization format matters (property order, spacing, decimals), confirm with a live mount probe per Step 3.4 — heavy children stubbed via `vi.mock('$lib/components/.../Heavy.svelte', async () => ({ default: (await import('./Stub.svelte')).default }))`; a plain-object mock throws `TypeError: default is not a function`. Run, capture the literal, delete the probe. A single recomputed literal fix qualifies for the CRITICAL auto-patch exception — grep all docs for the literal and patch every occurrence in lockstep. **Done when** every exact literal asserted in Tasks matches recomputed or probe output.

11. **Verify the test runner collects, env-maps, and gates every new test file** — for each test path Tasks creates:
    - **Net-new claim:** repo-wide search by basename AND by imported symbol before trusting "no tests exist"/"net-new" in any doc. A probe of one directory (`tests/unit/`) hides an existing suite elsewhere (`tests/lib/server/…`) whose assertions may pin the behavior being changed.
    - **Collection + environment:** read the runner config (vitest `include` + `environmentMatchGlobs`, Playwright `testDir`/`testIgnore`/`grep`) and confirm the path is both collected and mapped to the environment its imports need — a `node:sqlite` import in a path not mapped to node env crashes at import under the default DOM env. Silent in review, CRITICAL on first run.
    - **Gate coverage:** confirm the DoD gate command executes the file. A Playwright `grep` like `/^(?!.*@orchestration).*$/i` drops tagged specs from the default run — "all green" passes while the new e2e never ran; the DoD must name the extra `--grep @tag` invocation. Naming the invocation is not enough: Playwright ANDs config `grep` with CLI `--grep`, so when the config excludes the tag, `--grep @tag` selects ZERO tests and still exits 0 — a named-but-silent no-op gate. Execute each prescribed gate command once during the check and read the reporter's collected/passed count; zero collected = gap (record the working invocation — e.g. a sibling config that clears only `grep`, run via `--config` — in the DoD). Do not prescribe `--pass-with-no-tests` on a gate.
    Flag every mismatch with the config line that proves it. **Done when** every new test file traces path → collected → correct environment → a gate command that demonstrably collects a non-empty set.

12. **Verify guard-insertion anchors against surrounding side effects** — when a task says "insert guard before `<call>`", read the whole block from the anchor to the branch end: a counter or flag the anchor skips (`unreported++`) often feeds a later conditional write (`updateWaveStatus(wave.id, 'failed')`), so skipping only the named call still fires the downstream write and the guarded incident recurs one level up. Trace every statement the guard skips to its consumer; when one reaches a write, flag the anchor as load-bearing, require the task to name the exact line (counter included), and add a test case pinning the downstream write untouched while deferred (2026-08-20 latch-unlock spec: "before `resetTaskForRedispatch`" left the wave marked failed while its worker streamed). **Done when** every prescribed guard sits before every side effect it must suppress.

### Step 3: Bug and Quirk Discovery

Compare duplicate or parallel logic across components for undocumented bugs:

1. If two components implement the same logic (e.g., duplicate `isMarkdown()` vs `hasMarkdownSyntax()`), diff them. Any differences (even character-level like `\\x08` vs `\\b`) must be documented.
2. Check for caps, limits, or truncation logic in existing functions that new patterns might trigger (e.g., 3-tool cap in `enrichToolName()`).
3. Any discovered bug that the refactoring silently fixes must be called out in both Karpathy edge cases and Tasks risk register.
4. **Execute claimed behavioral bugs** — when a spec asserts a runtime bug, reproduce it before judging severity: write a temporary probe test in the project's own runner that imports the real module (aliases resolve; never hand-strip TypeScript for `node -e`), run it, delete the file. Probe the happy path too, not only the documented variant — severity is often understated.
5. **Find tests that pin the pre-fix behavior** — when a wave changes behavior, grep test files for expected values equal to the current buggy output; comments like "WIP bug" or "documents current behavior" mark them. Flag each pinned assertion with exact file and line in the gap list so the executor flips them alongside the fix instead of reverting the fix to satisfy them.

6. **Execute prescribed design mechanics, not just claimed bugs** — when Tasks prescribes a new integration pattern or branch (snippet prop through a container, sentinel early-return, drag math), validate it by running it: back up the target file (`cp` to /tmp), apply the spec's exact snippet to the real component, mount in the project's own runner with heavy children stubbed, run, then restore from the backup and confirm `git diff` shows the file clean. Dispatch the real trigger events (e.g. `mousedown` → `mousemove`) and assert the post-interaction value; a probe that asserts the initial state without firing the event passes vacuously and proves nothing. If a `vi.mock` fails on a missing export (icon library pulled in by the import chain), mock the heavy child component one level down instead of the library. A failing design probe is a CRITICAL gap — the spec's core mechanism does not work as written. **Done when** every prescribed pattern that can run headless has an executed probe, and the working tree is verified clean afterward.

### Step 4: Question-Count Verification

Verify Karpathy Layer 3 has exactly 8 questions per the feature-spec skill:
- Q1: persistent context
- Q2: non-negotiable conventions
- Q3: workspace structure + Module Map
- Q4: Module Communication Map
- Q5: Shared Layer
- Q6: files off-limits + module boundary rules (SINGLE question)
- Q7: verification automation
- Q8: build and test

If split or renumbered, flag.

### Step 5: Output and Save Coherence Report

Save the full report as `spec-check.md` in the **same spec folder** as the input docs.
This ensures findings persist alongside the deliverables for human review without scrolling chat history.

Then present a summary in chat:

```
📋 Spec Coherence Check: {feature name}
   Source: {path}
   Report saved: {path}/spec-check.md

   [✅/❌] 1. Cross-document fact trace
   [✅/❌] 2. Source-code reality check
   [✅/❌] 3. Bug and quirk discovery
   [✅/❌] 4. Question-count verification

   Gaps found: {count}
```

For each gap in the saved report:

```
⚠️ GAP-{N} ({severity: CRITICAL/MEDIUM/LOW})
   Layer: {which doc(s)}
   Issue: {one line}
   Impact: {what breaks during execution}
   Fix: {concrete patch instruction}
```

Default: report gaps only, do not auto-patch — most coherence fixes involve design judgment.

**Exception — auto-patch CRITICAL gaps with verifiable source-grounded fixes.**
Apply a fix directly when ALL of:
- Severity is CRITICAL (would break execution: compile error, runtime failure, malformed request)
- The correct value is grounded in existing source on disk (read the actual file, confirm the export/import/API param)
- The fix changes one fact in lockstep across every doc that contains it (PRD AND Tasks — never patch one layer and leave the contradiction in the other)

Then in the summary, mark each applied fix with ✅ APPLIED and the source file that grounded it.
MEDIUM/LOW gaps and any fix requiring a design decision stay report-only.

## Remediation Pass — when the user says "fix the gaps"

Runs only on explicit user request after a check; never remediate unprompted.

1. Classify each gap: doc-only fact rewrite, full-chain code fix, or design decision. Resolve design-decision gaps in this pass — the explicit request authorizes the decision: pick the option with codebase precedent, write the chosen option and rationale into the task body (both twins), and append the resolved decisions to karpathy-context.md so the base layer keeps up. When the chosen option anchors on parity with shipped behavior, verify that behavior in shipped code first — read the full handler chain (a child handler that `preventDefault`s and `return`s never reaches the parent; one handler read proves nothing); if code disproves the gap's own premise, the real contradiction is doc-vs-doc — fix the contradicting doc and amend the gap's issue text in spec-check.md with a strike-through correction so the audit trail stays honest. Done when every design-decision gap names its chosen option in Tasks.md, Tasks.json, and karpathy-context.md. Design decisions stay report-only during the check phase, before any remediation request.
2. Fix full-chain gaps link by link — type → mapper → shared util → component — adding one test per link. When a component would duplicate an existing helper, promote the helper to the shared layer instead of adding another copy.
3. Update every doc carrying the fact in lockstep: karpathy-context.md, PRD.md, Tasks.md, AND the Tasks.json twin — plus any ADR or architecture doc the fact appears in (grep the whole docs tree for the superseded phrasing: the contradicting row often lives in an ADR outside the spec folder). Task status, filesInvolved, and checklists must agree across both twins. Compose the Tasks.json edit from a fresh read of the exact block — grep-reconstructed JSON drifts on quotes and whitespace and fails the exact-match edit. Verify twin agreement programmatically after the edits (taskNumbers, titles, files, deps): strip inline backticks before matching MD headings to JSON titles — MD styles code spans (`` `/api/sessions` ``) where JSON holds plain text, so naive string matching flags pre-existing styling as drift. Confirm each residual flag against the pre-edit git commit before treating it as remediation drift.
4. Parse-verify the Tasks.json twin through the project's real reader (e.g. `readTasksJson`); eyeball parity is not verification. Read the reader's return interface before probing: readers transform fields — `readTasksJson` joins `filesInvolved` into a comma-joined string (DB-column format) though the raw JSON holds arrays — so probe with `filesInvolved.includes('path')`; array methods (`.some`, indexing) throw or return string garbage. Run the reader through a temporary vitest test in the project's own runner (TS and `$lib` aliases resolve there; a plain node script cannot import the module), assert the remediated facts appear in the parsed task descriptions — parse success alone proves nothing — then delete the probe and confirm a clean `git status`.
5. Run full gates and compare counts to baseline (unit tests = baseline + N new; type-check = baseline). Unexpected drift blocks completion.
6. Execute the task's manual verification live (headed browser, DOM query) and archive dated evidence under `test-results/`; mark the task done with timestamp + evidence path.
7. Sweep the spec folder for stale terms before reporting done: grep every value the edits superseded (old paths, old counts, old phrasing like "both surfaces"). Lockstep edits leave stragglers — one twin updated while its sibling keeps the old value. Fix each hit and re-sweep until the grep exits empty.
8. Append a remediation section to `spec-check.md`: gap → resolution → files touched, plus gate counts.

Done when every reported gap maps to a resolution row or an explicit user deferral.

## What This Skill Does NOT Do

- Does not check mermaid syntax (feature-spec Step 4.2 handles that)
- Does not check layman paragraphs (feature-spec Step 4.7 handles that)
- Does not re-run the feature-spec pipeline
- Does not auto-patch documents

## Evidence

Discovered during 2026-08-05 audit of `2026-08-04 - Exec-Tool-Enrichment-and-Markdown-Rendering` spec:
- Task 2.1 BEFORE/AFTER omitted ChipDetail's MemoryBlock/WebFetchBlock branches
- Task 2.2 said "same as ChipDetail" but components have different render chains
- `\\x08` bug in StandaloneToolCall's duplicate `isMarkdown()` undocumented across all 3 docs
- 3-tool cap in `enrichToolName()` undocumented
- Edge cases diverged (Karpathy: 6, PRD: 8, Tasks risk: 4, only 3 overlapped)
- Layer 3 had 9 questions instead of 8 (Q6 split into Q6+Q7)

Root cause: LLM attention degradation during long document generation. "Every X" rules degrade to "most X" by the third document.

Reference: `AI Research/YT-Research/2026-06-22 - Why Long Instructions Make AI Dumber - Attention Degradation Science.md`
