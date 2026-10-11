---
name: "dsi-sloc"
description: "Measure DSI source size in raw-code SLOC (comments and blanks stripped), find files over a threshold, and write a dated layman-friendly report under dev/sloc/. Reserved keyword: /dsi-sloc."
---

# DSI SLOC Report

One trigger → full measurement pipeline. Count raw-code SLOC across DSI's source, list the files over threshold, read each offender's internals, and save a dated report that a newcomer can skim.

## When to Use

- User runs `/dsi-sloc` or asks "which files are over N lines / SLOC?"
- User asks for a size/weight census of the codebase
- User asks "how big is X" with X a folder in this repo

### Step 0: No Params — Defaults

With no arguments, use these defaults (state them, don't ask):

- **Threshold**: 500 raw-code lines
- **Scope**: `src`, `bin`, `scripts`, `plugins` (exclude `src/lib/paraglide`, `.svelte-kit`, `build`, `node_modules`, generated code)
- **Metric**: raw-code SLOC (comments + blank lines stripped), not `wc -l`
- **Output**: `dev/sloc/{TODAY} - SLOC Report - Files Over {N} Raw-Code Lines.md`

---

## Step 0.5: Date Resolution ⛔ MANDATORY

Before constructing the report filename, resolve today's date via `date +%Y-%m-%d`. Store as `TODAY`. Never infer from context.

---

## Step 1: Measure

Count per-file raw-code SLOC with the `sloc` analyzer — never eyeball it from `wc -l` (DSI comments/blank density is ~35%, so `wc -l` misleads).

**Method — see `references/measurement.md`** for the exact per-file script and the sloc-in-temp-dir trick (`npx -p sloc` does NOT make the module importable). Key rules:

- Per-file counts, not just the aggregate — the report ranks files
- Report BOTH columns: raw code and total lines (the gap itself is a finding)
- `*.svelte` files count as JS for the analyzer; note this in the report methodology line

---

## Step 2: Read the Offenders

For every file over threshold, answer the **four-question skeleton** — see `references/report-skeleton.md` for the full format, layman language rules, and the worked example.

The four questions, always in this order:

1. **What is it?** — one plain sentence a newcomer understands
2. **What state does it own?** — the data living inside it (say "none — pure" when true)
3. **What jobs does it do?** — grouped bullets, biggest concern first, function names in backticks only as handles
4. **Who does it talk to?** — neighbours, boundaries, and what has already been split out

**Fan-out rule:** for 4+ files, delegate reading to parallel subagents (group by layer: server / services / components). Each subagent prompt must be self-contained (absolute path, raw-code figure, the skeleton, the layman style example) and must return ONLY finished markdown sections. Never paste raw subagent dumps — re-render through the skeleton yourself.

**⛔ Copy-paste prohibition:** the first draft of this report was rejected as "copy-paste, not layman friendly". A section that name-drops 30 identifiers in one paragraph fails. Every bullet must survive the test: *could a newcomer repeat this file's story after one read?*

---

## Step 3: Assemble and Save

Save to `dev/sloc/{TODAY} - SLOC Report - Files Over {N} Raw-Code Lines.md`:

1. Header: date, scope, file count, total raw-code SLOC, metric definition
2. "How to read this report" — names the four questions so the reader knows the shape
3. The over-threshold table: raw code | total lines | file path
4. Per-file sections (skeleton order, numbered heaviest-first)
5. **"Patterns worth noticing"** — 2-4 cross-file takeaways (infra vs UI weight, state ownership, wiring-vs-render split). This section is mandatory; it is where the report earns its keep

---

## Pipeline Checklist — MANDATORY

This is the ONLY checklist output to the user. Declared at the start. Verified at the end.

```
📋 dsi-sloc: threshold {N} — {scope summary}

   [ ]  0.5 ⛔ Resolve today's date via `date +%Y-%m-%d` (store as TODAY)

   Step 1: Measure
   [ ]  1.1  Per-file raw-code SLOC counted with sloc analyzer (not wc -l)
   [ ]  1.2  Generated code excluded (paraglide, .svelte-kit, build)
   [ ]  1.3  Over-threshold list ranked, raw + total columns

   Step 2: Read the Offenders
   [ ]  2.1  Every offender read (subagent fan-out when 4+ files)
   [ ]  2.2  Every section follows the four-question skeleton, same order
   [ ]  2.3  Layman test passed — no identifier-dump paragraphs

   Step 3: Assemble and Save
   [ ]  3.1  Report saved to dev/sloc/{TODAY} - ... (dated name)
   [ ]  3.2  Table + skeleton sections + Patterns section all present
   [ ]  3.3  Report presented to user

   ⛔ Behavioral Commitments:
   [ ]  I will NOT use wc -l as the SLOC metric
   [ ]  I will NOT paste raw subagent dumps into the report
   [ ]  I will NOT write a section that fails the newcomer test
   [ ]  I will NOT omit the Patterns section
   [ ]  I will verify the file exists on disk before declaring done
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Check-Off Rules

- Re-output the checklist at each phase transition with `[✅]` / `[🔄]` / `[ ]`
- At completion, output the final checklist: ALL `[✅]`, any `[❌]` for failures
- Do NOT deliver without showing the final checklist

---

## Attention-Degradation Protection

This skill stays SHORT. The measurement mechanics live in `references/measurement.md`; the report format, layman rules, and worked example live in `references/report-skeleton.md`. This file only orchestrates.
