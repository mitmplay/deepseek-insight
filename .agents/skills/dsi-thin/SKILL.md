---
name: "dsi-thin"
description: "Meta skill: take the dsi-sloc over-threshold report as input and batch-refactor multiple files to the ADR-0019 thin-shell standard — one branch, one batch ADR, a rolling pool of TWO parallel sub-agents (next file starts the moment one finishes), dsi-spec + dsi-task per file, gates and registry amendments enforced. Reserved keyword: /dsi-thin."
---

# DSI Thin — Batch Refactor from the SLOC Report

One trigger → batch thin-shell refactor. The `dsi-sloc` report is the input contract; the ADR-0019 standard is the authority; each file runs through dsi-spec → dsi-task as a sequential-commit wave unit, executed by a **rolling pool of two sub-agents**.

## When to Use

- User runs `/dsi-thin` or says "thin out the fat files" / "refactor the sloc report list"
- A freshly-landed thin-shell standard (e.g. ADR-0019) needs applying to the remaining over-threshold files

### Prerequisites ⛔

- An **authority ADR** must exist that defines the thin-shell standard. If absent, STOP — draft it first via `dsi-adr`; this skill applies a standard, it does not invent one.
- **Resolving the authority ADR — see `references/authority-adr.md`** for the full rules. Summary:
  1. **Live first**: discover the newest thin-shell ADR in `dev/architectural-decission/` (grep for the standard's name, e.g. "Floor Registry" / "thin shell"). Pick the ADR that **DEFINES the standard**, not merely applies it: if a candidate's TL;DR says it applies/extends another ADR's method (e.g. ADR-0020 applies ADR-0019's move-whole method at component scale), climb to the one it cites. The defining ADR's path goes into the batch ADR citation; applying ADRs (e.g. ADR-0020) are cited as WORKED EXAMPLES, not authority.
  2. **Snapshot fallback**: `references/ADR-0019-snapshot.md` is a dated copy of the standard at skill-freeze time — use it when the repo has no match (fresh clone, wrong repo, mirror-only context), and LABEL the run as snapshot-based.
  3. **Drift check**: when both exist and the live ADR is newer than the snapshot, note "live ADR differs from snapshot" and follow the LIVE one; refresh the snapshot as part of batch close.
- A fresh `dsi-sloc` report under `dev/sloc/` (run it if the latest is stale — files refactored since the report dropped below threshold and must not be re-picked).

---

## Step 0.5: Date Resolution ⛔ MANDATORY

Resolve today's date via `date +%Y-%m-%d`. Store as `TODAY`. Never infer from context.

## Step 1: Curate the Input List

1. Read the latest `dev/sloc/{date} - SLOC Report - *.md` over-threshold table.
2. **Re-verify each candidate live** — re-run the per-file SLOC count (`references/input-contract.md`); the report may be stale.
3. Present the ranked list to the user with, per file: raw code, its touchpoints (which shared registries/servers it hits), and a suggested **lane assignment** (see Step 3).
4. User picks, skips, and reorders. The confirmed list is the batch contract. Do NOT proceed without it.

## Step 2: Branch + Batch ADR

1. ⛔ **One branch per batch**: `refactor/thin-batch-{TODAY}`, created and activated BEFORE any artifact and BEFORE the first commit — no wave commit, spec commit, or ADR commit may land on any other branch. If the branch already exists (earlier run today), RESUME it: inspect its log and worktrees first, never create a same-day duplicate or commit to main while it exists.
2. **One batch ADR** via `dsi-adr` — but the depth rule applies to what is actually DECIDED here:
   - Cite the authority ADR (ADR-0019) as the standard being applied; do NOT re-argue it.
   - Decide only batch-specific questions: the confirmed file list, per-file exclusions and why, which frozen registries amend, the two-lane concurrency contract, and accepted give-ups.
   - Numbered decisions (D1…Dn), each naming its rejected alternative; diagram showing the two-lane pool and the merge gate.

## Step 3: The Two-Lane Rolling Pool ⛔ THE CORE MECHANIC

Run the batch through **two lanes, each a sub-agent, always two in flight**. The moment one lane's file fully completes (waves committed, gates green), immediately dispatch the next queued file into that lane. Never zero in-flight, never three.

⛔ **All DEVELOPMENT is sub-agent work** (operator rule, batch R3 2026-10-10): every wave, extraction, and code commit is executed by a lane sub-agent — the orchestrator NEVER writes `src/` code. The orchestrator's job is verification and gates only: doc-gate checks, independent disk re-runs of reported gate outputs (commit hash, suite count, SLOC — a worker claim is never accepted as evidence), one-lane-at-a-time merge-backs, and adjudications. Serial milestones keep a lane sub-agent too (pool contracts to one in-flight, not zero-with-orchestrator-coding). If a sub-agent stalls (no commit across two orchestrator polls), re-dispatch a FRESH sub-agent with incremental commit phases (commit after each doc/wave so progress is observable) before ever considering takeover.

### Concurrency safety — see `references/two-lane-contract.md` for the full contract

- **Lane isolation by git worktree**: each lane gets its own worktree (`.worktrees/lane-a`, `.worktrees/lane-b`) branched from the batch branch, so two agents never share one working tree, one dev-server port, or one suite baseline. `.worktrees/` MUST be in `.gitignore` before the first worktree is created (untracked lane dirs would pollute every main-tree `git status`/`add`).
- **Touchpoint disjointness**: when building the queue, pair files so the two in-flight files never mutate the same shared module (e.g. never floor-registry AND panel-registry together). If every pairing collides, fall back to strictly sequential for the colliding files — say so in the batch ADR.
- **Merge gate**: lane worktree commits merge back to the batch branch ONE LANE AT A TIME; the other lane keeps working undisturbed. After each merge, the merging lane re-bases its next file on the updated batch branch.
- **Suite baseline per lane**: each lane records the suite count from ITS starting commit; its gates compare against that. The merge gate re-runs the full suite on the batch branch after every merge.

### Per-file unit (what each lane sub-agent does — the Composer session's proven chain)

0. **Read the worked example first**: ADR-0020 + its spec folder + the wave completion notes (`dev/specs/2026-10/2026-10-10 - Composer Thin Shell/`) are the reference execution — and **check `references/proven-gates.md`** before writing any controller: paid-for lessons (`$effect.root` + `destroy()`, census assertion, live-getter props, focus fidelity) that fail quietly when skipped.
1. `dsi-spec` for the file — visible checklist in progress; PRD + Tasks + Karpathy context + Tasks.json under `dev/specs/{YYYY-MM}/{TODAY} - {File} Thin Shell/`
2. `dsi-task` for that file's waves — visible checklist in progress; behavior-neutral gates per wave: suites pass UNCHANGED (count + names), `svelte-autofixer` zero issues, `scripts/dep-graph.mjs --check` frozen crossings, **census assertion** (grep the shell for the moved declarations: zero hits)
3. Commit per wave: `refactor(ADR-00XX Wn): {what moved whole} — suites pass unchanged (N), +M unit tests`
4. If the file's floor registry must amend (the 500-line registry): stage the amendment in the lane, applied at merge time

### Stop-the-line rule

A file whose suites cannot stay green unchanged, or that reveals the standard doesn't fit it, falls OUT of the batch: record it in the batch ADR as a named rejected/excluded item with the reason, and continue the pool with the next file. One bad file never blocks the batch.

## Step 4: Goal + Todo Discipline (every batch)

- ONE batch goal at dispatch: objective = "Thin-shell refactor batch: {file list} per {authority ADR} on {branch}".
- Todos per file-wave: `file → W1`, `file → W2`, ..., plus one per merge-back and one for the final registry sweep.
- Update the todo the moment each unit completes; ALWAYS show the full todo list at every phase transition and after every lane completion. Never let the todo go stale between lane events.
- ⛔ **Visible-checklist pattern** (see `docs/visible-checklist-pattern.md` — declare → execute → announce, same-turn): the pipeline checklist is output at the START, then **checked in progress** — at every phase transition, doc gate, and lane merge, re-output it with `[✅]/[🔄]/[❌]` and announce EACH item's result immediately after verifying it, with the disk evidence inline (commit hash, suite count, SLOC number, dep-graph line). Two layers per the pattern: the visible checklist (social) + objective disk verification (`git log`, vitest counts, verify-sloc2, dep-graph) — a worker's report is NEVER the evidence; the orchestrator re-runs the check and announces the result. A claim without a matching disk check stays `[🔄]`.

## Step 5: Close the Batch

1. All files merged, pool drained.
2. Registry sweep: every refactored file that dropped below threshold is removed from the floor registry; `dep-graph --check` green.
3. Re-run `dsi-sloc` — the "after" report. The delta (before → after raw SLOC per file) is appended to the batch ADR as its evidence section.
4. Batch ADR → Implemented ONLY when every picked file is done or explicitly excluded with reason.
5. Show the final visible checklist: ALL `[✅]` / `[❌]` with reasons. Commit and push on user command (or per batch contract).

---

## Pipeline Checklist — MANDATORY

This is the ONLY checklist output to the user. Declared at the start. Verified at the end.

```
📋 dsi-thin: batch on {branch} — {n} files, two-lane pool

   [ ]  0.5 ⛔ Resolve today's date via `date +%Y-%m-%d` (store as TODAY)

   Step 1: Curate Input
   [ ]  1.1  Latest dsi-sloc report read; candidates re-verified live
   [ ]  1.2  Touchpoints identified per file; lane pairing plan built
   [ ]  1.3  User confirmed the batch list

   Step 2: Branch + Batch ADR
   [ ]  2.1  Branch refactor/thin-batch-{TODAY} created AND activated
   [ ]  2.2  Batch ADR drafted via dsi-adr (cites authority ADR, decides batch specifics only)
   [ ]  2.3  Two-lane worktrees created from the batch branch

   Step 3: Rolling Pool (per file, until queue empty)
   [ ]  3.1  dsi-spec per file (visible checklist shown)
   [ ]  3.2  dsi-task per file (visible checklist shown, behavior-neutral gates per wave)
   [ ]  3.3  Lane merge-back one at a time, full suite green on batch branch after each
   [ ]  3.4  Next file dispatched into the freed lane immediately (never 0 in-flight)
   [ ]  3.5  Todos updated and SHOWN after every lane event

   Step 4: Close
   [ ]  4.1  Registry amendments applied; dep-graph --check green
   [ ]  4.2  dsi-sloc re-run; before→after delta recorded in batch ADR
   [ ]  4.3  Batch ADR marked Implemented (or exclusions recorded with reasons)
   [ ]  4.4  Final checklist shown, all ✅/❌

   ⛔ Behavioral Commitments:
   [ ]  I will NOT make any commit before the batch branch exists and is activated
   [ ]  I will NOT run three sub-agents or let the pool drop to zero while queue remains
   [ ]  I will NOT let two in-flight files share a working tree or a shared-module mutation
   [ ]  I will NOT merge both lanes simultaneously — one lane at a time, suite-gated
   [ ]  I will NOT re-argue the authority ADR in the batch ADR
   [ ]  I will NOT let one failing file block the batch — it gets excluded with a reason
   [ ]  I will NOT go silent between lane events — todo + checklist always visible
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Check-Off Rules

- Re-output the checklist at each phase transition and after every lane merge with `[✅]` / `[🔄]` / `[ ]`
- At completion, output the final checklist: ALL `[✅]`, any `[❌]` for failures
- Do NOT deliver without showing the final checklist

---

## Attention-Degradation Protection

This skill stays SHORT. The input-contract mechanics live in `references/input-contract.md`; the full two-lane concurrency contract (worktrees, pairing, merge gate, failure recovery) lives in `references/two-lane-contract.md`; paid-for extraction lessons live in `references/proven-gates.md`. This file only orchestrates.
