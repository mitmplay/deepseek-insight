---
name: dsi-adr
description: Use when writing, reviewing, extending, or marking done any ADR in deepseek-insight's dev/architectural-decission/ — before drafting the first line, before approving one, and as the final self-audit before claiming an ADR is finished.
---

# DeepSeek Insight ADR Standard

Match depth to the decision space, never to the most recent ADR. Recent thin
ADRs are not authority — the exemplars are. This skill exists because an
agent under context rot reaches for the nearest template and produces a
decision record that asserts outcomes without recording why the alternatives
lost; that document re-litigates itself in six months. It is guidance with a
hard core: the self-audit in §5 is not optional.

Exemplars, in authority order (paths relative to the DSI repo root):

1. `dev/architectural-decission/2026-08-27 - The Lineage Pin — Sub-Agents Below Their Spawner, Swap-Proof.md` — the gold standard: D1–D7, sequence + flowchart + state homes + control matrix, glossary, amendments log.
2. `dev/architectural-decission/2026-08-24 - The Panel Floor — Many Conversations, One Page.md` — decision set with honest give-ups.
3. `dev/architectural-decission/2026-08-29 - The Prompt Macro — Bang Runs the Shelf, Line by Line.md` — deep format on a composer-scale feature.

Read the exemplar closest to your subject before drafting a new ADR kind.

## 1. ADR or KB?

An ADR records a **decision and its cost** — what we chose, what we rejected,
what we accept by choosing it. A KB note records **mechanics** — how a
surface works today, for the newcomer. The pair discipline: a KB that
documents current behavior ends by naming the open question; the ADR that
answers it cites the KB as companion. If your draft asserts choices but
names no rejected alternative, it is a KB note wearing an ADR's filename —
rehome it or deepen it.

## 2. The skeleton (old-guard format)

```markdown
# ADR — <The Name>: <The Claim in One Line>

- **Date:** YYYY-MM-DD
- **Status:** Proposed          ← Accepted only after implementation proves it
- **Companions:** <linked KB notes + ADRs this stands on>
- **Supersedes:** <what it retires, or "nothing — …">
- **Question this answers:** *<the operator-visible question, one sentence>*

## TL;DR — for the reader in a hurry
## 1. The problem, in plain words          ← operator story, not architecture story
## 2. What the codebase/host already gives us (the facts)   ← numbered, sourced
## 3. The principle, unfolded              ← the rule the decisions instantiate
## 4. Decisions
### D1 — <decision as a claim>             ← why + REJECTED alternative + why it loses
### D2 — …
## 5. <lifecycle sequence diagram>         ← wherever state changes hands
## 6. <flowchart / control matrix / state homes — as the subject needs;
##       split into further numbered sections when several apply>
## Diagrams: mermaid (flow & sequence) blocks; state homes and control
##       matrices stay markdown tables
## 7. Consequences                         ← gains / accepted give-ups / what does NOT change
## 8. File map (implementation footprint)  ← every file + the tests that pin it
## Glossary (for the layman)               ← a newcomer reads without the codebase
## Post-implementation amendments          ← dated entries, never edit the body in place
```

Number the decisions `D1…Dn` and treat the numbers as addresses: later ADRs
and KB notes cite "D3" instead of re-describing the rule. Diagram menu — pick
what the subject needs, skip none that applies: sequence (a lifecycle),
flowchart (branching rules), state-homes table (where a fact lives and which
copy is authority), control matrix (who may do what per row species). Create
sequence and flowchart diagrams as mermaid (```mermaid sequenceDiagram /
flowchart) blocks — the exemplars' house format; state-homes and control
matrix stay markdown tables. Validate every mermaid block parses (e.g.
mermaid.parse) before claiming done — mermaid treats `;` as a statement
separator, so message text cannot carry one.

## 3. The depth rule

Count the real alternatives BEFORE choosing a length. The honest test:

- Name every alternative you actually weighed. If you cannot name at least
  two rejected alternatives across the ADR, either the decision is too small
  for an ADR (write a KB note or a code comment instead) or you have not
  thought hard enough yet. Both happen; only one is excusable.
- Length follows the alternative space, not a template minimum or maximum.
  The thin five-section format (context / rule / lives / gave-up / proving)
  is acceptable ONLY for mechanical moves with no real alternative space —
  and the absence of alternatives must be a finding, not an oversight.
- Fusing alternatives into one assertive paragraph is the failure this skill
  exists to prevent. A rejected alternative needs its rejection reason in
  writing, at the decision it lost to.

## 4. Fact discipline

Every fact in §2 traces to something you actually inspected this session: a
file and line, a wire capture, a test, a dated ADR. Never carry a fact
forward from memory of a previous session, and never cite a line number
without re-reading it. In the final document, keep the sources concrete
(file paths, ADR names, dated specs) so a reviewer can re-walk the evidence.

## 5. The self-audit (before claiming done)

Answer each aloud, in the transcript, yes or no:

1. Did I enumerate the real alternatives, or fuse them into a paragraph?
2. Does EVERY decision name what it rejected and why the rejection lost?
3. Can a newcomer follow the TL;DR + glossary without opening the codebase?
4. Does every §2 fact carry a source I read THIS session?
5. Is there a diagram wherever state changes hands or authority moves —
   mermaid (`sequenceDiagram` / `flowchart`) for flows and sequences, and
   does every mermaid block parse clean?
6. Did I copy a recent ADR's shape instead of matching the trade?
7. Does Consequences include what does NOT change (so reviewers see the
   blast radius is bounded)?
8. Does the file map name the tests that will pin the behavior?

Any "no" is an unfinished ADR. Fix it or shrink the ADR's claim — never
declare done with a standing "no".

## 6. Reviewing an ADR

Run the same audit from the outside. The three rejection reasons that matter
most: a decision with no named alternative; a fact with no source; a
consequence section that lists only gains. Style is negotiable; those three
are not.
