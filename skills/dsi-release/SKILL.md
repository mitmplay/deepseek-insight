---
name: dsi-release
description: Use when a DSH release/tag jump needs analyzing for DeepSeek Insight impact — deciding whether DSI owes an update, fix, or feature, and writing the KB release note that records the verdict. Covers fetching the tag range, diffing the three touchpoints (wire, rejection codes, session ledger), probing DSI's matchers, and the report template with self-audit.
---

# DSH Release → DSI KB Comparison Standard

Every DSH alpha/tag jump must be *checked, not trusted*: pre-release, the
harness renames freely and owes guests no translation layer. This skill runs
that check mechanically and records the verdict as a KB note in
`dev/kb/releases/`, so each jump has a written baseline the next one diffs
from. It exists because the failure mode is a quiet break — the alpha.2
rejection-code rename kept everything working until a user opened a missing
session and got a wrong-flavored error card.

Exemplars, in authority order (paths relative to the DSI repo root):

1. `dev/kb/releases/2026-09-01 - The Alpha Jump — DSH 0.1.2-alpha.1 to alpha.3, What Changed and What DSI Must Adapt.md` — the deep case: a wholesale rename found, five files patched, live probe, dead-code discovery.
2. `dev/kb/releases/2026-09-03 - The Quiet Jump — DSH 0.1.2-alpha.3 to alpha.5, What Changed and What DSI Owes.md` — the quiet case: 302 commits, nothing owed, one polish item, every "unchanged" diff-verified at the tags.

Read the exemplar matching your jump's size before drafting.

## 1. Establish the range

The previous release KB names the edition DSI was last verified against —
that tag, not "whatever we remember", is the range start. The new tag is the
one the host now runs (confirm: `git log -1` on the tag, the running `dsh web`
process, or the compare URL the operator supplies). If the previous KB stops
more than one edition back, analyze every missing gap — an untouched middle
edition is a finding, not a reason to skip it.

```sh
cd ~/agentic-ai/deepseek-harness
git remote -v                        # origin may be a fork without dsh-* tags
git fetch --tags https://github.com/deepseek-ai/deepseek-harness.git
git tag -l 'dsh-v*'
git log --oneline <old>..<new> | wc -l
git log --oneline <old>..<new> | grep -oE '^[a-f0-9]+ [a-z]+\([^)]*\)' \
  | sed 's/^[a-f0-9]* //' | sort | uniq -c | sort -rn   # theme census
```

## 2. Diff the three touchpoints (the whole compatibility question)

DSI touches the host in exactly three places. Diff each **at the tags**, in
the DSH checkout — commit messages and Agent Notes are claims until grepped.

**a. The wire** (method names, argument/result fields, paging semantics):

```sh
git diff <old>..<new> -- packages/api/session-controller/src/client/contract \
  packages/api/session-controller/src/history.ts \
  packages/api/session-controller/src/list.ts \
  packages/api/session-controller/src/commands.ts
```
Filter out internal type-branding noise (`SessionSeq`, `SessionLogOffset`,
`Branded`) — it is compile-time; the notes must say whether numeric wires
change, and you verify the wire adapter anyway (e.g. `wireHeader()`).

**b. The rejection codes** DSI matches (`grep -rn "err.code\|=== '"` in
DSI's `src/lib/server/`, then):

```sh
git diff <old>..<new> -- packages/api | grep -E "^[+-].*RemoteError\("
git grep -n '<code-spelling>' <new> -- packages/api
```

**c. The ledger** DSI reads (JSONL contract):

```sh
for t in <old> <new>; do git grep -h 'SESSION_FORMAT_VERSION =' $t -- packages; done
# Event-type vocabulary has NO single home: SessionEventMap members are declared
# across capability packages (tool events live in packages/core/tools/src/types.ts),
# so set-diff the known-type LIST at both tags. Never trust a single file diff -
# the 2026-09-09 Missed Rename: events.ts diffed empty while the ptc-dispatch
# rename landed in tools/types.ts. Set-diff the union of declaring files:
for t in <old> <new>; do
  git grep -h "dispatch\|tool/\|turn/\|step/\|assistant/" $t -- \
    packages/core/session/src/known-event-types.ts \
    "packages/*/[^/]*/src/types.ts" 2>/dev/null | sort -u > /tmp/evt-$t.txt
done
diff /tmp/evt-<old>.txt /tmp/evt-<new>.txt   # every moved spelling shows here
```

Also check `SESSION_FORMAT_VERSION`, the `SessionEventMap` members (a new
model-visible event type is a DSI rendering opportunity), and the
`ignorable: true` rule (unknown events required-on-read unless marked).

## 3. Check DSI's matchers against the diff

For every wire string, code spelling, or validation message that moved,
grep DSI for who matches it (`src/lib/server/dsh-rpc.ts`,
`dsh-connection.ts`, route `+page.server.ts`/`+server.ts`, command
parser/executor prose). Classify each hit: **live matcher** (code compares
`err.code`), **prose** (docstring/JSDoc naming a code), or **local mirror**
(DSI re-validates what the host also validates — flag divergence in either
strictness direction).

## 4. Probe and verify before writing the verdict

- If matchers changed: patch them, then run the loop:
  `npx vitest run` → `npm run check` → `DSH_LIVE=1 npm run test:live`
  (live tests need a valid cookie against the running host; a dev server
  minted before a restart still works — signed cookies survive host
  restarts, launch tokens do not).
- If nothing changed: say so with tag-diff evidence, and confirm the
  existing live suite still applies unedited.
- A matcher that *cannot fire* is a fact worth probing, not keeping (the
  Alpha Jump's `not-pending` and dead-404 discoveries). When in doubt,
  probe through DSI's own stack (the dev server proxying a real call).

## 5. The KB note template

Filename: `dev/kb/releases/YYYY-MM-DD - <The Name> — DSH <old> to <new>, <What Changed and What DSI Owes/Must Adapt>.md` — date is when the analysis ran.

```markdown
# <The Name> — DSH <old> to <new>, …

> KB note, YYYY-MM-DD. Written <the trigger: what jumped, when, what DSI's
> live-verified claims still described>. Sources: <git ranges with commit
> counts>, the range's Agent Notes, and tag-vs-tag greps — every claim
> confirmed in both trees. Successor to <previous release KB>.

## The question, restated in plain terms
<Operator-story framing; the switchboard mental model; the one-sentence
verdict up front — "nothing owed" or "N spellings across M files".>

## The journey, edition by edition
<mermaid flowchart: one node per edition, child nodes per notable change;
count the PRs/commits per hop; color the DSI-breaking node(s).>

## What changed, by DSI touchpoint
### The wire (what DSI speaks) — <verdict>
### The rejection codes (what DSI matches) — <verdict>
### The ledger (what DSI reads) — <verdict>
### What the host bought itself (gratitude, not action)
<Host-internal upside DSI need not copy — recorded so the next jump's
reader knows it was considered, not missed.>

## What DSI owes the new edition
<Table: item | where (file:line) | why it matters | cost. Old→new spelling
pairs each verified in both trees. If nothing: the one polish item, or an
explicit zero with the verification loop restated for the next jump.>

## Takeaway
<The debt paid or the quiet jump confirmed; the operating rule restated.>

**Open question:** <a KB ends by naming its open question — the next
decision this note surfaces but does not answer.>
```

## 6. The self-audit (before claiming done)

Answer each aloud, yes or no:

1. Did the range start at the edition the previous KB actually verified, and cover every gap since?
2. Were all three touchpoints diffed at the tags — not read from commit messages or notes alone?
   For the ledger: was the known-event-type SET set-diffed across declaring files (step 2c),
   not one file diff? A per-file diff can pass while the vocabulary moves — the 2026-09-09 Missed Rename.
3. Does every "unchanged" claim name the files the diff covered?
4. Was every DSI matcher greped and classified (live / prose / mirrored-validation)?
5. If matchers moved: did the verification loop run green (unit, check, live)?
6. Does the note state the verdict in its first screen (a reader in a hurry must not excavate it)?
7. Does "What the host bought itself" show considered-and-skipped work, not silently-missed work?
8. Does the note end with a real open question (not a restated takeaway)?

Any "no" is an unfinished report. Fix it — never declare done with a
standing "no".

## 7. Mirror discipline

The repo-local copy (`.agents/skills/dsi-release-kb/SKILL.md`, DSI repo) is
the versioned source of truth; the mirror at `~/.agents/skills/dsi-release-kb/`
makes it visible to every harness host's `skills/list`. After editing the
repo copy, re-copy it to the mirror — a skill the slash menu never sees is
a skill nobody invokes (RCA 2026-09-03 — The Skill the Slash Menu Never Saw).
