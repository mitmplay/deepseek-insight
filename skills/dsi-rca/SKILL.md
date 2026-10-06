---
name: dsi-rca
description: Use when writing, reviewing, or marking done any RCA in deepseek-insight's dev/kb/rca/ — before drafting the first line and as the final self-audit before claiming the RCA is finished. Enforces the narrative standard the operator set after rejecting a copy-paste RCA — layman glossary, story-driven failure chains, and a mermaid flowchart AND sequence diagram are hard requirements, not style preferences.
---

# DeepSeek Insight RCA Standard

An RCA that reads like release notes is a failed RCA. This skill exists
because an agent under context rot pastes the commit message into a template
and calls it a root-cause analysis — no story, no layman path in, no
diagrams. The operator rejected exactly that (2026-10-06: *"paragraph seems
like just copy paste, lack of proper narrative, not layman friendly, and
worst do not have mermaid flow & sequence diagram"*). Everything below is
that rejection turned into law.

The exemplar that defines the bar:
`dev/kb/rca/2026-10-06 - RCA — The Renderer That Told the Truth Badly
(Dull Diagrams, Single-Line Tables, Captures From the Top).md` — three bugs,
one shared root, four mermaid diagrams, and a glossary a newcomer reads
before any code.

**References (load before drafting):**

- `references/rca-template.md` — the copy-verbatim skeleton, section-by-
  section depth guide, and the single-defect variant note. **The template
  lives there, not here; never write an RCA from memory of this page.**
- `references/mermaid-rules.md` — diagram choice table (flowchart vs
  sequence), the seven syntax gates that have each broken a real diagram,
  and the accessibility/tone rules for label text.

## 1. RCA or ADR or plain KB?

- An **ADR** (dev/architectural-decission/, see the `dsi-adr` skill) records
  a *decision and its cost* — what was chosen, what was rejected.
- A **KB note** documents *how a surface works* today.
- An **RCA** (dev/kb/rca/) reconstructs *how a defect came to exist and what
  its existence teaches*. If your draft names no decision to revisit and no
  defect to explain, it is not an RCA — rehome it. An RCA that ends without
  a carry-forward lesson is a post-mortem of the code; the lesson is the
  post-mortem of the *process*.

## 2. The hard requirements (any "no" = unfinished)

1. **Narrative, never paste.** Every section explains *why* in plain
   sentences before naming a file or line. Commit messages, diff hunks, and
   test output may be *cited*, never pasted as prose. If a paragraph could
   stand inside a commit message, rewrite it.
2. **Quote the operator.** Open with the defect in the operator's (or the
   test's, or the user's) own words. The gap between those words and the
   code is the story the RCA tells.
3. **Layman glossary before the body.** A *Words used below* table defines
   every term the body will use in one plain sentence each. A newcomer reads
   the note top-to-bottom without opening the codebase.
4. **A mermaid flowchart per failure chain.** Each bug/defect gets its own
   `flowchart TD` tracing decision → inherited consequence → visible
   symptom → complaint. The chain shows how a *reasonable* choice at time T
   became a defect at time T+1 — that is the root in root-cause.
5. **A mermaid sequenceDiagram wherever responsibility moves between
   actors** (operator ↔ component ↔ runtime, caller ↔ clone). A flowchart
   shows *how the state went bad*; the sequence shows *who handed it over*.
   Choice table and syntax gates: `references/mermaid-rules.md`.
6. **A shared-root paragraph** when the RCA covers multiple defects: one
   paragraph naming the single underlying cause (stale defaults, an
   inheritance chain, a missing contract) that the individual fixes merely
   trimmed. Multi-bug RCAs without a shared root are a changelog.
7. **"What does NOT change"** — the blast radius must be bounded in writing,
   so the reader knows what the fix deliberately left alone.
8. **"What to carry forward"** — dated, portable lessons (not "be careful";
   rules like *"a clone is a photograph of a fresh document"*), each earned
   by a specific trap in this RCA.
9. **Fact discipline (same as the ADR skill):** every fact traces to
   something inspected THIS session — file + line, a simulation's output, a
   test run, a commit sha. Cite the shas.

## 3. The self-audit (before claiming done)

Answer each aloud, in the transcript, yes or no:

1. Is every section narrative — could any paragraph be pasted into a commit
   message? (Must be no.)
2. Are the operator's own words quoted at the top?
3. Would a newcomer who reads only the glossary + opening follow the story
   without the codebase?
4. Does EVERY failure chain have a mermaid flowchart, and does every
   multi-actor hand-off have a sequence diagram — all parsing clean per
   `references/mermaid-rules.md`?
5. Does a multi-defect RCA name the shared root in one paragraph?
6. Is "What does NOT change" present and specific?
7. Is every carry-forward lesson a rule earned by a named trap?
8. Does every fact carry a source inspected this session (file+line, sha,
   simulation output)?
9. Does the note follow the `references/rca-template.md` skeleton — all
   headings present, all guidance deleted?

Any "no" is an unfinished RCA. Fix it or shrink its claim — never declare
done with a standing "no".

## 4. Reviewing an RCA

Run the same audit from outside. The three rejection reasons that matter
most: a section that reads like a commit message; a missing or unparsable
diagram; a carry-forward list of vibes. Style is negotiable; those three
are not.
