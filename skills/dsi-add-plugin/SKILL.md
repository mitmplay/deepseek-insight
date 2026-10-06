---
name: dsi-add-plugin
description: Use when the user runs /dsi-add-plugin or asks to install/add a dsh plugin or an agent-preset into the web profile — covers the five install gates (allowBuilds, prepare, D4 manifest match, bundles mount, RPC verify), local-link vs git-hosted vs npm sources, and the post-install checklist that catches the bundles clobber.
---

# DSI Add Plugin — the five-gate install playbook

Installing a plugin or agent-preset into a dsh profile crosses **five gates**.
Every install failure this surface has ever produced was one gate failing
closed while every earlier gate already passed (RCA 2026-10-06, "The Install
That Fixed Its Way Forward"). Walk the gates IN ORDER; never retry an install
after a fix without checking the NEXT gate proactively — each fix historically
bought exactly one gate.

Read [references/checklist.md](references/checklist.md) first — it is the
step-by-step procedure with the exact commands. The other references are
lookup tables you open when a specific gate bites:

- [references/checklist.md](references/checklist.md) — the ordered procedure
  (source classification → gates 1-5 → verify).
- [references/allowbuilds-template.md](references/allowbuilds-template.md) —
  allowBuilds snippet shapes: exact sha key, wildcard bet, and the placeholder
  trap to grep for.
- [references/verification.md](references/verification.md) — verification
  commands: offline composition dump, live `agentPresets/list` RPC (with the
  cookie mint), rack snapshot refresh.

## The gates, one line each

1. **Source** — classify what you are installing: npm package, git-hosted
   repo, or local directory (link dep). The source decides which later gates
   apply.
2. **allowBuilds (profile)** — the profile's `pnpm-workspace.yaml` must
   allow every git-hosted package's build scripts. Keys for git packages are
   sha-pinned: a new release means a new key.
3. **allowBuilds (package)** — a git-hosted package's own prepare runs its
   own `pnpm install` under ITS OWN allowlist. Grep BOTH yaml files for
   placeholder text before trusting any boolean.
4. **D4 manifest match** — after `dsh plugin add` succeeds, the profile
   manifest must record a dependency whose repo tail matches the reff URL.
   Reff lines point at REPOSITORY ROOTS, never `/tree/` browse pages.
5. **bundles mount** — dependencies install, `dsh.profile.bundles` mounts.
   Every `dsh plugin add` REWRITES the bundles array to just the new plugin:
   after any install, re-append every bundle that should still be mounted.

## Hard rules (earned 2026-10-06)

- NEVER hand-edit the manifest's `dependencies` for a dsh-managed plugin —
  shell out to `dsh plugin add` (rack D3). Hand-edits are allowed only for
  local link deps and the bundles array.
- NEVER trust the installer's success message as the finish line; the mount
  and the RPC are the truth (D4).
- NEVER force-push; a rejected push stops the skill.
