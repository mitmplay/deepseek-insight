# AGENTS.md

DeepSeek Insight (DSI) is the insight layer and conversation surface for
DeepSeek Harness: a SvelteKit app that reads the harness's records (docs,
notes, session logs) and speaks its native RPC. This file seeds DSI's agent
instructions; add sections as conventions harden, keep each rule
self-contained, and link depth out to skills rather than growing this file
into a manual.

## ADR pattern (dev/architectural-decission/)

Match depth to the decision space, never to the most recent ADR — a thin
recent ADR is not authority; the exemplars are (The Lineage Pin 2026-08-27,
The Panel Floor 2026-08-24, The Prompt Macro 2026-08-29). Hard requirements
for every ADR:

- Numbered decisions (`D1…Dn`), each naming its rejected alternative and why
  the rejection lost — a decision with no named alternative is unfinished.
- Every stated fact traceable to a source the author inspected (file + line,
  wire capture, test, dated ADR).
- A diagram wherever state changes hands or authority moves (sequence,
  flowchart, state homes, control matrix — as the subject needs).
- TL;DR and layman glossary, so a newcomer follows without the codebase.
- Consequences split gains / accepted give-ups / what does NOT change.
- File map naming the implementation footprint and the tests that pin it.
- A KB note (dev/kb/) documents how a surface works; an ADR records what was
  decided and what it cost. A KB ends by naming its open question; the ADR
  that answers it cites the KB as companion.

**Invoke the `dsi-adr` skill before drafting, reviewing, or marking done any
ADR** — it carries the full skeleton, the depth test, and the self-audit.

## run_code tool-call hygiene

One malformed `run_code` program fails whole and costs every sub-call
batched with it. Before submitting a program, check every sub-call against
these rules (observed failure patterns, session a5d4bf28 2026-09-06):

- Every `tools.bash()` / `tools.read()` / `tools.edit()` sub-call inside a
  `run_code` program carries its own `description`; one missing field rejects
  the whole program.
- Do not embed shell or Python scripts as heredocs or `node -e '...'` inside
  template literals — nested quoting produces parse errors (`Expected ',',
  got 'ident'`). Write the script to a file with `tools.write`, then run it
  with a one-line bash command.
- After any bulk sed/python sweep, cached `old_string` targets are stale;
  re-read (or `grep -n`) the exact lines immediately before each
  `tools.edit()`.
- Bash results are objects shaped `{ stdout: { text }, ... }`, not strings;
  read `r.stdout.text`, never call `r.stdout.slice()`.

The skill's repo-local copy (`.agents/skills/dsi-adr/`) is the versioned
source of truth; a mirror at `~/.agents/skills/dsi-adr/` makes it visible to
every harness host's `skills/list` (the slash menu) regardless of host cwd.
After editing the repo copy, re-copy it to the mirror
(RCA 2026-09-03 — The Skill the Slash Menu Never Saw).
