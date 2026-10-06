# Install Checklist — five gates, in order

Run top to bottom. Every command was executed live on this surface
(2026-10-06); the failure each step prevents is named beside it.

## 0. Classify the source

| Source | Route | Gates that apply |
|---|---|---|
| Local directory (agent-preset, bundle patch only) | link dep + manual bundles append (§4a) | 5 only — no prepare, no pnpm gate |
| Git-hosted repo | `dsh plugin add github:owner/repo --profile web` | 2, 3, 4, 5 |
| npm package | `dsh plugin add <name> --profile web` | 5 (a bare name that 404s means it is git-only) |

An agent-preset is almost always a **local link**: its bundle patch inserts a
`preset-*` row, and pnpm cannot install a subdirectory of a repo anyway.

## 1. Pre-flight the content (agent-presets only)

Before installing, diff the preset's `cordis.patch.yml` against the SHIPPED
preset of the RUNNING runtime
(`~/.npm/_npx/*/node_modules/@deepseek-ai/dsh-web-app/presets/*.patch.yml`):

- No row mounts a plugin the shipped presets no longer mount
  (2026-10-06: `dsh-workflow-worker-thread` → `dsh-workflow-ptc`).
- Every row consuming an isolate realm sits INSIDE the group declaring it
  (the `compaction` group owns `command-compact` + `tool-result-pruner`).
- Every `name:` exists in the runtime's `@deepseek-ai/` packages.

## 2. Gate: allowBuilds (profile) — git-hosted only

```bash
grep -n 'allowBuilds' -A 10 ~/.dsh/profiles/web/pnpm-workspace.yaml
```

- The install error prints the EXACT key to add (it embeds the tarball
  commit sha). Add it verbatim, quoted (the URL contains `:`).
- Also add a wildcard bet:
  `"pkg@https://codeload.github.com/owner/**": true`.
- See [allowbuilds-template.md](allowbuilds-template.md).

## 3. Gate: allowBuilds (package) — git-hosted only

The tarball's prepare runs its own `pnpm install`. Fix the PACKAGE's
`pnpm-workspace.yaml` in its source repo, commit, push, AND mirror — the
push moves the tarball sha, which RE-ARMS gate 2 (add the new sha key).

```bash
grep -n 'set this to true' <repo>/pnpm-workspace.yaml && echo 'PLACEHOLDER FOUND'
```

Placeholder text where a boolean belongs is a live trap — both homes have
shipped one (esbuild in DSI, node-pty in the profile).

## 4. Install

### 4a. Local directory (agent-preset)

1. Add to the profile manifest:
   - `dependencies`: `"@local/<name>": "link:<absolute path>"`
   - `dsh.profile.bundles`: append `"@local/<name>"` — APPEND, never let an
     installer rewrite the array.
2. `cd ~/.dsh/profiles/web && pnpm install`
3. Confirm the link resolved: `ls node_modules/@local/<name>`

### 4b. Git-hosted / npm

```bash
dsh plugin add github:owner/repo --profile web
```

Then **re-open the manifest** and re-append every OTHER bundle that should
still be mounted (gate 5). Historical clobbers: `dsh-agent-teams`,
`dsh-agency-agents`, `@local/dsh-app-dev-preset` all vanished this way.

## 5. Gate: D4 manifest match — after every `dsh plugin add`

```bash
node <rack-engine> refresh --reload
```

Every reff row must come back `installed` consistent with reality, with no
errors. If a row says "manifest does not record a dependency matching
<URL>": the reff URL is a browse page (`/tree/`) or its tail does not match
the recorded dep. Reff lines point at repository roots.

## 6. Restart, then verify the mount

A restart is REQUIRED — the running host mounts bundles at boot only.

```bash
# offline, no restart needed:
dsh --profile web --dump-config | grep -n 'preset-<id>'
# live, after restart (see verification.md for the cookie mint):
POST /api/agentPresets/list   →  every preset: broken absent
```

Only the live RPC answers for the session that resumes. `--dump-config`
proves composition; the RPC proves mount health.
