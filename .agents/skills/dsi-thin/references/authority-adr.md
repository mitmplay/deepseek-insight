# Authority ADR — resolution rules

The thin-shell standard lives in a repo ADR (currently ADR-0019, "The Floor Registry — The Machine Moves Whole, the Shell Stays Thin"). This skill must never INVENT the standard — only apply it. But a hard-coded path breaks: ADRs get amended, superseded, renumbered, and this skill also runs from the `~/.agents/skills` mirror where no repo may be present. So the authority is dual-sourced:

## Source 1 — the live ADR (preferred)

```bash
# discover candidates
grep -rln "thin shell\|Floor Registry\|Thin Shells" dev/architectural-decission/ | sort
```

Pick the newest ADR that defines the standard and is not marked superseded: highest ADR number, latest date, and its status line says Draft/Accepted/Implemented (NOT superseded/rejected). Its path is what the batch ADR must cite, and the per-wave commits reference its number (`refactor(ADR-00XX Wn): ...`).

## Source 2 — the frozen snapshot (fallback)

`references/ADR-0019-snapshot.md` is a verbatim copy of ADR-0019 at skill-freeze time (2026-10-10, commit 392054d^). Use it only when no live ADR is discoverable (fresh clone of the mirror, skill used outside the DSI repo). When used, the batch ADR must say: "authority = ADR-0019 via skill snapshot; live repo copy not found".

## Drift check (both exist)

If the live ADR and the snapshot differ (diff the two, or compare the live file's git log against the freeze date):

- Follow the LIVE one — it is the standard of record.
- Say so once: "live ADR differs from the skill snapshot; following live".
- At batch close, refresh the snapshot: copy the live ADR over `references/ADR-0019-snapshot.md`, update this file's freeze stamp, and include the refresh in the batch commit.

## Supersession

If discovery finds a NEWER standard ADR that supersedes the thin-shell one (e.g. ADR-0030 replaces the floor model), STOP and ask the user: this skill's mechanics (per-file waves, registry amendments, unchanged-suite gates) assume the ADR-0019 shape. Adapting to a new standard is a skill revision, not a runtime decision.
