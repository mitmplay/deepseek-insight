# Mermaid Rules for RCAs — Syntax Gates & Diagram Choices

Companion to `rca-template.md`. Same discipline as dsi-spec's
`references/mermaid-pattern.md`: mermaid is grammar, not decoration — an
unparsable block renders as raw text and fails the narrative contract as
surely as a missing diagram.

---

## Which diagram, when

| Situation | Diagram | Why |
|---|---|---|
| One defect's decision → consequence → symptom chain | `flowchart TD` | Shows how a reasonable choice at time T became a defect at time T+1 — the root in root-cause. |
| Actors hand state/messages to each other (operator → component → runtime → clone) | `sequenceDiagram` | A flowchart shows how state went bad; the sequence shows WHO handed it over. |
| Multi-defect RCA | one flowchart per defect + at least one sequence for the shared actor story | Per-defect chains stay readable; the sequence carries the shared root. |

Hard floor: **every failure chain gets a flowchart; every multi-actor
hand-off gets a sequence.** A multi-defect RCA with zero diagrams cannot
pass the self-audit.

## Syntax gates (each one has broken a real diagram)

1. **No `;` in message or label text** — mermaid treats it as a statement
   separator and silently eats the rest of the line.
2. **`<br/>` for line breaks inside node labels** — literal newlines inside
   `["…"]` labels are unreliable across renderers.
3. **Single-token participant/actor names** — long names go on the `as`
   clause: `participant Op as You (operator)`.
4. **Every `alt`/`else`/`opt`/`loop` closes with `end`.**
5. **Quote every node label** — `A["text (with parens)"]`; unquoted parens
   and slashes are the classic parse error.
6. **Edge labels are pipes with quotes**: `-->|"label text"`.
7. **Validate before claiming done** — `mermaid.parse` in a scratch node
   script, or the Preview tab in Zed, or DSI's own MarkdownContent preview.
   An unparsable block is requirement-failing, cosmetic-fixable-later.

## Accessibility & tone

- Label text carries the *narrative* ("the reasonable decision at time T"),
  not ids (`A`, `B`) — a diagram read aloud must still tell the story.
- Dotted edges (`-.->`) mark dead ends and disconnected paths (the legacy
  folder that nothing reads) — visual grammar for "not part of the live
  chain".
- Keep flowcharts ≤ ~8 boxes; split into per-defect diagrams rather than one
  spaghetti graph.
