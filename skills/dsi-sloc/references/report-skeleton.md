# Report Skeleton — the Four-Question Format

The report format hardened after the operator rejected the first draft as "copy-paste, not layman friendly". The failure mode to avoid: paragraphs that string together thirty backticked identifiers — technically accurate, unreadable.

## File conventions

- Path: `dev/sloc/{TODAY} - SLOC Report - Files Over {N} Raw-Code Lines.md`
- `TODAY` from `date +%Y-%m-%d`, never from context
- Numbered sections, heaviest file first

## Report structure (in order)

1. **Header** — date, scope, file count, total raw-code SLOC, metric definition (one line: "Raw-code lines = SLOC excluding comments and blanks, measured with the `sloc` analyzer").
2. **"How to read this report"** — names the four questions so the reader knows every section has the same shape.
3. **The over-threshold table** — columns: raw code | total lines | file path. Ranked descending by raw.
4. **Per-file sections** — the skeleton below.
5. **"Patterns worth noticing"** — 2-4 cross-file takeaways. MANDATORY. Good pattern topics: infra vs UI weight; who owns state vs who is pure; "heavy because it wires, not because it renders"; the raw-vs-total gap.

## The four-question skeleton (per file)

Every section answers the same four questions in the same order:

```markdown
### {n}. {FileName} — {raw} code lines

**What is it?** One plain sentence a newcomer understands. Name its role, not its functions.

**State it owns:**
- The data living inside it, in plain terms (one bullet per cluster, not per variable)
- Or: "None — it is a pure decision-maker / pure mapping library" when true

**Jobs it does (grouped):**
- *Concern name in italics* — what it does for the user/system, in a clause; `functionName` in backticks only as a handle
- Biggest concern first, 4-6 groups

**Who does it talk to?** Neighbours and boundaries over HTTP/events/imports. End with what has ALREADY been split out into siblings — it tells the reader the file's remaining weight is deliberate.
```

## Layman rules

1. **The newcomer test**: after one read, could someone repeat the file's story to a colleague? If a bullet only works if you already know the function, rewrite it.
2. **Lead with the metaphor, keep the handle second**: "the single phone line between DSI and the harness — every message goes through this one file". Then `getDshConnection` may appear once as the handle.
3. **Group, don't list**: "Placement and selection — deciding where a new panel lands, deduping re-opens, removing a panel plus its children" — NOT a bare list of `insertionSlot`, `pinnedSlotIndex`, `removePanel`.
4. **Verbs over nouns**: "detects gaps (missed messages)" beats "coverageFloor gap detection".
5. **Say "none — pure" proudly**: statelessness is the most useful fact a reader can learn about a file.
6. **Backticks are handles, not prose.** If removing all backticks makes a bullet meaningless, the bullet is a name-dump. Rewrite.

## Worked example (the section that passed)

```markdown
### 3. prompts/db.ts — 777 code lines

**What is it?** The database behind the prompt Shelf — a small local SQLite file that
remembers your saved prompts and which ones you actually use.

**State it owns:**
- The SQLite database itself, opened from a config-path ladder and cached so it opens only once.

**Jobs it does (grouped):**
- *Setup* — migrates the schema to v4 (adds full-text search with typo-tolerant trigram matching, and a tags column).
- *Recording habit* — bumps a prompt's use count on every send; prunes the table at 5,000 rows.
- *Finding prompts* — a three-tier search waterfall: exact substring, then full-text, then a fuzzy re-rank by word similarity. Includes a guard so the search box doesn't match itself.
- *Manager editing* — list with sorting and tag filters, create, update, rename, delete.

**Who does it talk to?** Serves the composer's help finder and the PromptManagerPanel — but only
through the /api/prompts HTTP layer; the UI never imports this file directly.
```

## Subagent fan-out pattern

For 4+ offender files, read them in parallel subagents instead of serially:

- **Group by layer** (server / services / components) — 2-3 files per agent.
- The prompt must be **self-contained**: absolute repo path, the exact file list with raw-code figures, the four-question skeleton, the layman rules above, and this style anchor:

> Style example (do not copy content): "And what's in those 509 code lines now: the props contract, submit receipt ladder, sync registration, wiring of the four controllers, effects, and the template."

- Demand: "Return ONLY the finished markdown sections."
- **⛔ Never paste subagent output straight into the report.** Subagents drift toward identifier dumps even with the rules in front of them — treat their output as RESEARCH NOTES and re-render each section through the skeleton yourself. This re-render is where the layman language actually gets enforced.
