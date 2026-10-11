---
name: "dsi-thin"
description: "Meta skill: take the dsi-sloc over-threshold report as input and batch-refactor multiple files to the ADR-0019 thin-shell standard. Four phases in strict order: SLOC list → per-file ADR (dsi-adr) → per-file spec docs (dsi-spec: Karpathy + PRD + Tasks md + tasks.json) → VERIFICATION GATE (abort if any folder incomplete) → execution by a rolling pool of TWO parallel dsi-task sub-agents. Reserved keyword: /dsi-thin."
---

# DSI Thin — Batch Refactor from the SLOC Report

One trigger → batch thin-shell refactor. The `dsi-sloc` report is the input
contract; the ADR-0019 standard is the authority. The batch runs as **five
phases in strict order, and the order itself is the gate**:

1. **SLOC generation** — run `dsi-sloc`, curate the over-threshold list.
2. **Per-file ADR** — `dsi-adr` for each listed file.
3. **Document generation** — `dsi-spec` for each listed file: Karpathy
   context + PRD + Tasks (md) + tasks.json, committed BEFORE any code.
4. **Verification** — every spec folder must contain all four artifacts.
   If ANY folder is incomplete: **ABORT the batch.** Do not "fix it later",
   do not proceed with the complete ones. An incomplete folder at this gate
   means the pipeline is broken; running code past it wastes the operator's
   time (RCA 2026-10-10 — six folders, zero Karpathy, zero tasks.json).
5. **Execution** — a rolling pool of TWO parallel sub-agents, each running
   `dsi-task` only. Lanes never write specs; specs already exist and are
   verified.

Why the order is hard: in the 2026-10-10 batch (ADR-0021), spec generation
lived inside the lane sub-agent's job. Dispatch prompts summarized the
four-artifact pipeline down to "write a short PRD", the artifacts were
silently dropped, and PRDs entered git in the same commit as — or after —
the code they governed. Green-outcome gates (tests, census, dep-graph)
could not see the violation. This skill's fix is structural: specs are
produced and verified by the orchestrator BEFORE any code wave may start.

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

## Phase 1: SLOC Generation — Curate the Input List

1. Run the `dsi-sloc` skill → produces `dev/sloc/{date} - SLOC Report - *.md` with the over-threshold table.
2. **Re-verify each candidate live** — re-run the per-file SLOC count (`references/input-contract.md`); the report may be stale.
3. Present the ranked list to the user with, per file: raw code, its touchpoints (which shared registries/servers it hits), and a suggested **lane assignment** (see Phase 5).
4. User picks, skips, and reorders. The confirmed list is the batch contract. Do NOT proceed without it.

## Phase 2: Branch + Batch ADR + Per-File ADRs

1. **One branch per batch**: `refactor/thin-batch-{TODAY}`, created and activated BEFORE any artifact.
2. **One batch ADR** via `dsi-adr` — the depth rule applies to what is actually DECIDED here:
   - Cite the authority ADR (ADR-0019) as the standard being applied; do NOT re-argue it.
   - Decide only batch-specific questions: the confirmed file list, per-file exclusions and why, which frozen registries amend, the two-lane concurrency contract, and accepted give-ups.
   - Numbered decisions (D1…Dn), each naming its rejected alternative; diagram showing the five-phase pipeline and the two-lane pool.
3. **Per-file ADR** — for EVERY file on the confirmed list, run `dsi-adr` to produce that file's refactoring ADR (what moves whole, where it lands, which frozen crossings it touches), committed to the batch branch BEFORE Phase 3. Do not summarize a file's ADR into the batch ADR — one ADR per file, or the per-file plan is a dispatch-prompt rumor again.
   - Excluded files get a named rejection in the batch ADR instead of a per-file ADR.

## Phase 3: Document Generation — dsi-spec Per File ⛔

For EVERY file on the confirmed list, run the `dsi-spec` skill itself —
**never a hand-written summary of it** (RCA 2026-10-10: dispatch prompts
that summarized the pipeline produced 0 Karpathy contexts and 0 tasks.json
across six files). Each run generates its folder under
`dev/specs/{YYYY-MM}/{TODAY} - {File} Thin Shell/` containing ALL FOUR:

- Karpathy context (the self-interrogation document)
- PRD
- Tasks document (markdown, visible checklist)
- tasks.json (machine-readable)

**Commit each file's spec folder to the batch branch before any code for
that file exists.** A spec commit is a gate input, not a deliverable: the
execution phase refuses a file whose spec commit is not already in its
history.

## Phase 4: Verification Gate ⛔ ABORT ON FAILURE

Before dispatching ANY lane, verify per file, mechanically — `ls` the
folder, do not trust self-reports (the 2026-10-10 audit found lane
self-reports said "spec artifacts written" while meaning "a PRD exists"):

- [ ] folder `dev/specs/{YYYY-MM}/{TODAY} - {File} Thin Shell/` exists
- [ ] Karpathy context file present and non-empty
- [ ] PRD present and non-empty
- [ ] Tasks markdown present and non-empty
- [ ] tasks.json present and valid JSON
- [ ] spec folder commit precedes any code commit for the file (`git log` — for a fresh batch there are no code commits yet, so trivially true)

**If ANY file fails: ABORT the entire batch.** Report which files, which
artifacts, and stop. Do not run the lanes on the "complete" subset — an
incomplete folder means the generation pipeline itself failed, and
executing past the gate is exactly the paperwork-after-the-machine defect
this gate exists to prevent. Fix the generation, re-run Phase 3, re-verify.

## Phase 5: Execution — The Two-Lane Rolling Pool ⛔ THE CORE MECHANIC

Only reachable when Phase 4 is fully green. Run the batch through **two
lanes, each a sub-agent running `dsi-task`, always two in flight**. The
moment one lane's file fully completes (waves committed, gates green),
immediately dispatch the next queued file into that lane. Never zero
in-flight, never three. **Lane agents NEVER write specs** — the folder they
need is verified present; they read it and execute.

### Concurrency safety — see `references/two-lane-contract.md` for the full contract

- **Lane isolation by git worktree**: each lane gets its own worktree (`.worktrees/lane-a`, `.worktrees/lane-b`) branched from the batch branch, so two agents never share one working tree, one dev-server port, or one suite baseline. `.worktrees/` MUST be in `.gitignore` before the first worktree is created (untracked lane dirs would pollute every main-tree `git status`/`add`).
- **Touchpoint disjointness**: when building the queue, pair files so the two in-flight files never mutate the same shared module (e.g. never floor-registry AND panel-registry together). If every pairing collides, fall back to strictly sequential for the colliding files — say so in the batch ADR.
- **Merge gate**: lane worktree commits merge back to the batch branch ONE LANE AT A TIME; the other lane keeps working undisturbed. After each merge, the merging lane re-bases its next file on the updated batch branch.
- **Suite baseline per lane**: each lane records the suite count from ITS starting commit; its gates compare against that. The merge gate re-runs the full suite on the batch branch after every merge.

### Per-file unit (what each lane sub-agent does — dsi-task only)

0. **Read the worked example first**: ADR-0020 + its spec folder + the wave completion notes (`dev/specs/2026-10/2026-10-10 - Composer Thin Shell/`) are the reference execution — and **check `references/proven-gates.md`** before writing any controller: paid-for lessons (`$effect.root` + `destroy()`, census assertion, live-getter props, focus fidelity) that fail quietly when skipped.
1. Read the file's (already verified) spec folder + per-file ADR; run `dsi-task` for its waves — visible checklist in progress; behavior-neutral gates per wave: suites pass UNCHANGED (count + names), `svelte-autofixer` zero issues, `scripts/dep-graph.mjs --check` frozen crossings, **census assertion** (grep the shell for the moved declarations: zero hits)
2. Commit per wave: `refactor(ADR-00XX Wn): {what moved whole} — suites pass unchanged (N), +M unit tests`
3. If the file's floor registry must amend (the 500-line registry): stage the amendment in the lane, applied at merge time

### Stop-the-line rule

A file whose suites cannot stay green unchanged, or that reveals the standard doesn't fit it, falls OUT of the batch: record it in the batch ADR as a named rejected/excluded item with the reason, and continue the pool with the next file. One bad file never blocks the batch.

## Step 6: Goal + Todo Discipline (every batch)

- ONE batch goal at dispatch: objective = "Thin-shell refactor batch: {file list} per {authority ADR} on {branch}".
- Todos per phase per file: `file → ADR`, `file → spec`, `file → verify`, `file → W1`, `file → W2`, ..., plus one per merge-back and one for the final registry sweep.
- Update the todo the moment each unit completes; ALWAYS show the full todo list at every phase transition and after every lane completion. Never let the todo go stale between lane events.

## Step 7: Close the Batch

1. All files merged, pool drained.
2. Registry sweep: every refactored file that dropped below threshold is removed from the floor registry; `dep-graph --check` green.
3. Re-run `dsi-sloc` — the "after" report. The delta (before → after raw SLOC per file) is appended to the batch ADR as its evidence section.
4. Batch ADR → Implemented ONLY when every picked file is done or explicitly excluded with reason.
5. Show the final visible checklist: ALL `[✅]` / `[❌]` with reasons. Commit and push on user command (or per batch contract).

---

## Pipeline Checklist — MANDATORY

This is the ONLY checklist output to the user. Declared at the start. Verified at the end.

```
📋 dsi-thin: batch on {branch} — {n} files, spec-gated two-lane pool

   [ ]  0.5 ⛔ Resolve today's date via `date +%Y-%m-%d` (store as TODAY)

   Phase 1: SLOC Generation
   [ ]  1.1  dsi-sloc run; report under dev/sloc/
   [ ]  1.2  Candidates re-verified live; touchpoints identified; lane pairing plan built
   [ ]  1.3  User confirmed the batch list

   Phase 2: Branch + ADRs
   [ ]  2.1  Branch refactor/thin-batch-{TODAY} created AND activated
   [ ]  2.2  Batch ADR drafted via dsi-adr (cites authority ADR, decides batch specifics only)
   [ ]  2.3  Per-file ADR via dsi-adr for EVERY confirmed file, committed (exclusions named in batch ADR)

   Phase 3: Document Generation (per file)
   [ ]  3.1  dsi-spec SKILL invoked per file (never summarized) — Karpathy + PRD + Tasks md + tasks.json
   [ ]  3.2  Each spec folder committed to the batch branch

   Phase 4: Verification Gate ⛔
   [ ]  4.1  Per file: all four artifacts present and non-empty (checked via ls, not self-reports)
   [ ]  4.2  tasks.json valid JSON
   [ ]  4.3  ⛔ ANY failure = ABORT the batch, report, fix generation, re-run Phase 3
   [ ]  4.4  Two-lane worktrees created from the batch branch (gate green only)

   Phase 5: Execution — Rolling Pool (per file, until queue empty)
   [ ]  5.1  dsi-task per file (visible checklist shown, behavior-neutral gates per wave)
   [ ]  5.2  Lane merge-back one at a time, full suite green on batch branch after each
   [ ]  5.3  Next file dispatched into the freed lane immediately (never 0 in-flight)
   [ ]  5.4  Todos updated and SHOWN after every lane event

   Step 7: Close
   [ ]  7.1  Registry amendments applied; dep-graph --check green
   [ ]  7.2  dsi-sloc re-run; before→after delta recorded in batch ADR
   [ ]  7.3  Batch ADR marked Implemented (or exclusions recorded with reasons)
   [ ]  7.4  Final checklist shown, all ✅/❌

   ⛔ Behavioral Commitments:
   [ ]  I will NOT dispatch any lane until Phase 4 verification is fully green for EVERY file
   [ ]  I will NOT summarize dsi-spec into a dispatch prompt — the skill runs, all four artifacts
   [ ]  I will NOT proceed past a failed verification with a "complete subset" — I ABORT and fix generation
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

This skill stays SHORT. The input-contract mechanics live in `references/input-contract.md`; the full two-lane concurrency contract (worktrees, pairing, merge gate, failure recovery) lives in `references/two-lane-contract.md`; paid-for extraction lessons live in `references/proven-gates.md`; the verification-gate evidence lives in `dev/kb/rca/2026-10-10 - RCA — The Paperwork That Arrived With the Machine (Specs Written After the Code They Govern).md`. This file only orchestrates.
