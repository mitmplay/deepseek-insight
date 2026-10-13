---
name: dsi-restart
description: Restart the DSI/DSH floor with a before/after report — /dsi-restart snapshots every listener's port+pid+RSS, restarts (or waits for the operator's restart), re-snapshots, and prints the delta table (which ports restarted, memory freed/claimed). Answers "floor feels heavy, restart and show me what changed".
---

# dsi-restart — restart with receipts

Companion: `dsi-ports` skill (the snapshot pipeline) and the Port Ledger KB (`dev/kb/open-ports/`). This skill adds the DELTA: before, restart, after, memory moved.

## 0. Identify how the floor is running (do not skip)

**Facts first (2026-10-12, hard rule):** classify launch shape ONLY from a full
ancestry walk — `ps -o pid,ppid,lstart,command` repeated up the ppid chain
until you reach pid 1 or an interactive `zsh`/`login`. Record each hop. An
immediate-parent glance is not detection: the same zsh can own both a dead
floor's corpse and the replacement the OPERATOR launched by hand (precedent
2026-10-12: the assistant claimed a "detached relaunch" that was actually the
operator re-running the command in their own terminal). **Never narrate a
relaunch you did not perform and cannot cite a pid + start time for.**

| Launch shape | Detection (full ancestry walk) | Who may restart it |
|---|---|---|
| Operator's foreground terminal | the `bin/dsi.mjs` chain's top parent is an interactive `zsh`/`login` (walk ppids; lstart proves which launch is which) | **the operator only** — or the Restart Verb with the operator's go (§2) |
| Detached chain (plugin-rack / verb bounce) | the chain's top parent is pid 1 (launchd) | the skill, via the Restart Verb or `--sync-kills` + relaunch |

If detection is ambiguous → **ask the operator** before killing anything (precedent: pid 37084, 2026-10-12 — the assistant killed the operator's live floor during cleanup).

**Exit-143 rule (2026-10-12, corrected):** when the floor dies — Ctrl-C, kill,
or the Restart Verb hitting a foreground-terminal floor — the terminal prints
`ELIFECYCLE Command failed with exit code 143` and the floor is **DOWN. It
does not come back by itself.** Only the detached restart chain (the verb's
spawned one-shot) or a human re-running the command brings it back. Never
write or say "the floor came back detached" without a pid + `lstart` you just
read from `ps` — an unverified rebirth story cost the operator a dead floor
and a wrong incident report (2026-10-12).

## 1. Snapshot BEFORE

Run the dsi-ports pipeline (see dsi-ports skill for the script) and save:

```sh
sh /tmp/dsi-ports.sh > /tmp/floor-before.txt
```

## 2. Restart

- **PREFERRED, every shape: the Restart Verb (shipped — ADR "The Restart Verb,
  One Button, One Route, Receipts", 2026-10).** With the operator's go, click
  the power button in the sidebar header (or `POST /api/floor/restart`). It
  spawns the same detached chain plugin-apply uses, so the floor re-serves in
  the same mode (`--sync --dev in-process` fidelity) even when the previous
  floor lived in the operator's terminal. Receipts still apply: BEFORE/AFTER
  snapshots are mandatory.
- **Fallback, detached/agent-owned floor:** `dsi dsh --sync-kills`, then
  relaunch the exact previous command (copy it from `ps` BEFORE killing).
- **Fallback, operator foreground floor (operator declines the verb):** print
  the restart command and WAIT for the operator to run it (their Ctrl-C, their
  terminal). Remember: once it dies, it stays dead until someone starts it.

## 3. Snapshot AFTER (wait for both listeners first)

Poll until the expected ports answer (host + UI), then:

```sh
sh /tmp/dsi-ports.sh > /tmp/floor-after.txt
```

## 4. The delta report (this is the deliverable)

Present exactly this table — join BEFORE and AFTER on port purpose (not pid: pids always change):

| Port | Purpose | RSS before | RSS after | Delta | PID before → after |
|---|---|---|---|---|---|
| 3080 | DSH host | 3262 MB | 1489 MB | **−1773 MB** | 38237 → 41200 |

Then one summary line: total floor RSS before → after, and the verdict:
- large negative delta + all expected ports up → **restart healthy**
- a port missing after → **name it loud** (that half of the floor did not come back)
- RSS after ≥ before → say so honestly; restart did not reclaim (possible leak — offer dsi-rca)

## Boundaries

- Never kill a process the operator owns without their confirmed go (§0).
- Always restore the EXACT previous launch command/flags/env — a restart that changes the floor's shape is a config change, not a restart.
- The report is the point: a restart without before/after receipts is just downtime.
