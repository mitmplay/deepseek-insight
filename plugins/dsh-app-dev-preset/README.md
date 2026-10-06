# dsh-app-dev-preset — agent-preset bundle template

A starting point for a **user agent-preset bundle** for DeepSeek Harness
(DSH). (An *agent preset* is a recipe for one kind of agent; in DSI it appears as
a button in the session filter row.) Copy it, rename the identity, register it on the host profile, restart.
Full mechanics: `dev/kb/agent-presets/2026-10-06 - The Preset Bundle — Author,
Register, Remove an Agent Preset.md`. Decision record: ADR-0015 (2026-10-06).

## Files

- `package.json` — bundle manifest; `dsh.bundle.patch` points the loader at
  the patch file. Rename `name` to `@local/dsh-<my-id>-preset`.
- `cordis.patch.yml` — inserts the preset row (`id`, `name`, `description`,
  `order`) plus the agent-plane plugin composition (persona, tools, skills,
  goals, plan mode, subagents, workflows, web).

## 1. Copy the template

```bash
cp -R ~/agentic-ai/deepseek-insight/template/dsh-app-dev-preset ~/agentic-ai/<my-id>-preset
```

Then in the copy:

1. `package.json`: set `"name": "@local/dsh-<my-id>-preset"`.
2. `cordis.patch.yml`: change the insert row —
   - `id: preset-<my-id>` (entry id),
   - `config.id: <my-id>` (the preset id DSI filters on),
   - `config.name` / `config.description` (roster copy),
   - `config.order` (roster sort; shipped `standard`-class presets sit low).
3. Trim or keep the `plugins:` list. **Realm rule:** any row consuming
   `compaction` / `toolResultPruner` (or publishing a process-global
   service) must sit inside the matching `cordis:group` with `isolate:` —
   loose rows fail the mount audit (*The Preset That Waited*, 2026-09-12).

## 2. Register on the host

Edit `~/.dsh/profiles/web/package.json` and add the dependency plus its
`link:` specifier (mirroring how `@local/dsh-app-dev-preset` is wired):

```json
"dependencies": {
  "@local/dsh-<my-id>-preset": "link:/Users/wharsojo/agentic-ai/<my-id>-preset"
}
```

Then:

```bash
cd ~/.dsh/profiles/web && pnpm install
```

Restart `dsh web` — the registry is populated at boot; there is no watcher.

## 3. Remove

1. Delete the `@local/dsh-<my-id>-preset` entries from
   `~/.dsh/profiles/web/package.json`.
2. `cd ~/.dsh/profiles/web && pnpm install`.
3. Restart `dsh web`; delete the bundle directory if desired.

Do **not** bother with `~/.dsh/.agent-presets/<id>/` — that legacy directory
is not read by anything any more.

## The prompt part

The only prompt text in the bundle is the `persona` row's `config.prefix`
(`{{model}}` / `{{cwd}}` resolve per session). Everything else is plugin
composition — capability, not wording.
