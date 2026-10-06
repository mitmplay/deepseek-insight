# dsh-research-preset — agent-preset bundle template (read-only research agent)

A **user agent-preset bundle** for DeepSeek Harness (DSH) in the current
(new-format) bundle shape: `package.json` + `cordis.patch.yml`. The legacy
`preset.yml` + `agent.cordis.yml` pair this folder once carried is retired —
nothing reads that format any more; see
`dev/kb/agent-presets/2026-10-06 - The Preset Bundle….md` for the full
story, and `../dsh-app-dev-preset/` for the sibling application-developer
template.

## What this preset is

**Research** — a deliberately tool-poor, read-only investigation agent:
web search, codebase search/read, skills, todos, goals, compaction for long
sessions. **No shell, no file editing, no plan mode, no subagents.** When a
task needs those, its persona says so and recommends the `app-dev` or
`main` agent.

## 1. Copy and rename

```bash
cp -R ~/agentic-ai/deepseek-insight/template/dsh-research-preset ~/agentic-ai/<my-id>-preset
```

Then in the copy:

1. `package.json`: `"name": "@local/dsh-<my-id>-preset"`.
2. `cordis.patch.yml` insert row:
   - `id: preset-<my-id>`, `config.id: <my-id>`,
   - `config.name` / `config.description` (roster copy),
   - `config.order` (research sits at 20; app-dev at 10),
   - `config.plugins` — trim to the tools your agent should have. The
     **realm rule**: rows consuming `compaction`/`toolResultPruner` (or
     publishing process-global services) must stay inside the
     `cordis:group` with the matching `isolate:`, or the mount audit
     rejects the preset (*The Preset That Waited*, 2026-09-12).

The prompt lives in one place: the `persona` row's `config.prefix`
(`{{model}}` / `{{cwd}}` resolve per session). Roster metadata is never
prompt text.

## 2. Register

```json
"dependencies": {
  "@local/dsh-<my-id>-preset": "link:/Users/wharsojo/agentic-ai/<my-id>-preset"
}
```

in `~/.dsh/profiles/web/package.json`, then
`cd ~/.dsh/profiles/web && pnpm install` and **restart `dsh web`** (the
registry is populated at boot; there is no watcher).

## 3. Remove

Delete the dependency entries from the profile `package.json`,
`pnpm install`, restart the host. Folder deletion alone does nothing.
