# DeepSeek Insight

- `DSH web` shows you a conversation. 
- [DeepSeek Insight](https://gitlab.com/wharsojo.dev/deepseek-insight) (DSI) shows you the **whole floor**

> `DSI` as a `Control room` built on your harness's own records: every session, past and running, side by side on one page; lineage tree of sub-agents pinned under the parent that spawned them; every tool call with its pass/fail receipt; history you can search; prompts worth keeping filed for reuse. It speaks the same wire as the `DSH` you already run — nothing new to configure.

## Run

The whole DX loop lives in the home page: pick a preset + workspace, press **+ New chat** and watch your agent work.
> tool chips pass/fail with durations and receipts, reasoning folds open, older turns load as you scroll up, and when a turn needs permission the approval card answers it with one click.

### What you'll see

Everything on the page is **real harness activity**, not a mock — every chip, diff, and reply is read straight from the running harness.

- **Conversation, with receipts.** Each tool the agent runs shows as a chip that passes or fails, with its duration and its receipt; open it to see exactly what ran. Reasoning folds away until you want it, and long sessions load older turns as you scroll up.
- **The workspace explorer, with git diff.** A side panel shows the files your agent is touching. Changed files are flagged and pulsing while the agent works; click one and you get a **real git diff** — additions in green, removals in red — rendered from the file's live buffer, so it updates as the agent edits and refreshes if you (or anything else) change the file underneath.
- **Presets and workspaces.** Start each chat with the right agent for the job — a coder, a researcher, a generalist — pointed at the right folder.
- **Many conversations, one page.** Conversations live in panels you can open side by side; compare two runs, or keep a scratch chat next to the main one.
- **A family tree under every chat.** When your agent spawns sub-agents, they appear as their own panels **below the parent that made them** — a ghost-tinted panel that stays put on refresh, so you always know who was working for whom. And when one conversation is worth a second try, **fork it**: one click clones the loaded context into a fresh session that starts exactly where the original stood — same history, new task.
- **A prompt library that files itself.** Save any bubble into the library and give it short filing words (tags) at save time; filter the prompt manager by tag chips or `+tag` words in the search box, and narrow the suggestion strip with its own tag chips — filters survive a reload. Tune the offered tags in `~/.dsi/settings.yaml` under `prompts.tags`.
- **Your language.** The interface speaks English, Chinese, and Indonesian.

### Run from npm

Install [Node.js](https://nodejs.org) (>= 22.19), open a terminal, and run the **recommended one-liner**:

```sh
npx @deepseek-insight/dsi@latest dsh --sync --zai
```

What that single command does, in plain words:

- `npx @deepseek-insight/dsi@latest` — fetches the newest published DSI and runs it, **no install step**; nothing is added to your project, and `@latest` is what keeps it the latest.
- `dsh` — talk to the harness side: this subcommand starts the **DSH host** (`dsh web`) and the **DSI page** together, as one pair.
- `--sync` — copies the harness one-time launch token into DSI config (`~/.dsi/settings.yaml`) so the page can speak to the host, then serves both in the foreground — **one window, one Ctrl-C stops both**.
- `--zai` — **optional.** It bootstraps the GLM (Z.AI) provider into the harness settings (`~/.dsh/settings.yaml`). **If you do not have a GLM account, simply leave it off** — DSI will use whatever provider your harness is already configured with:

```sh
npx @deepseek-insight/dsi@latest dsh --sync
```

When it is up, your browser opens the page by itself (default `http://127.0.0.1:5174`). Run it again later and DSI even cleans up after a lost previous run: `dsi dsh --sync-kills`.

## License

[Apache-2.0](LICENSE) — Copyright © 2026 Widi Harsojo
