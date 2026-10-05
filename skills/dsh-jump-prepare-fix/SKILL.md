# DSH Jump Unstick — the `prepare` Scheduler-Symbol Split

Every DSH edition jump that dies with `Cannot read properties of undefined
(reading 'prepare')` on the first tool call has ONE verified cause class and ONE
validated fix. This skill exists so the jump is never blocked twice on the same
bug — the 2026-09-18 jump to `dsh-v0.1.6-alpha.2` lost the session to it, and
the diagnosis had to be rebuilt from scratch on 2026-09-19.

Authority: upstream [discussion 783](https://github.com/deepseek-ai/deepseek-harness/discussions/783)
names the mechanism for global installs; the 2026-09-19 probe (below) proved the
source-checkout variant and validated the fix end to end.

## When to use

- A DSH checkout just moved (pull / tag checkout / rebuild) and EVERY tool call
  in EVERY session fails with `Cannot read properties of undefined (reading
  'prepare')`, code `UNKNOWN`, ending the turn.
- Or the jump aborted earlier and `~/.dsh/sessions/**/session.v3.jsonl.zstd`
  shows a `turn/end` with that exact message.
- Do NOT use for other `undefined` errors — the message must name `prepare`.

## The mechanism, in one paragraph

`packages/core/tools` exports `TOOL_RUNTIME_SCHEDULER = Symbol(...)` — a plain
Symbol, so each loaded copy of the module mints a distinct key. The tools
registry registers the scheduler under ONE copy's Symbol; the agent loop reads
it through the OTHER copy's Symbol; the lookup yields `undefined` and
`.prepare` throws. What splits the copies depends on launch mode: in a global
install it is a profile-local `pnpm install` materializing `@deepseek-ai/*`
under `~/.dsh/profiles/<name>/node_modules` (discussion 783); in a
source-checkout launch (`pnpm dsh …` = `node --import tsx/esm apps/cli/src/bin.ts`)
the 2026-09-19 probe caught the cordis plugin loader importing BOTH
`packages/core/tools/src/index.ts` (via tsx tsconfig `paths`) AND
`packages/core/tools/lib/index.js` (via package `exports`) in the same process.
Any jump that changes plugin resolution can re-trigger it.

## Confirm before fixing (2 minutes, optional but cheap)

Instrument both copies, reproduce, read the stacks:

```sh
# in the moved checkout, add after the Symbol line in BOTH
# packages/core/tools/src/index.ts and packages/core/tools/lib/index.js:
if (process.env.DSH_PROBE_SYMBOL) console.error('[PROBE]', import.meta.url, new Error('stack').stack)

export DSH_PROBE_SYMBOL=1
pnpm dsh --profile headless "Use the bash tool to run: echo probe" 2>&1 | grep PROBE
```

Two `[PROBE]` lines with different URLs (one `src/`, one `lib/`, or two
distinct trees) = this bug. One line only = something else; stop and re-diagnose.

## The fix (validated 2026-09-19 against a pristine alpha.2 worktree)

Make the scheduler key copy-robust with the global symbol registry, in BOTH
copies of `packages/core/tools`:

- `src/index.ts`:
  `export const TOOL_RUNTIME_SCHEDULER: unique symbol = Symbol.for('@deepseek-ai/dsh-tools.scheduler')`
- `lib/index.js` (after the line `const TOOL_RUNTIME_SCHEDULER = …`):
  `Symbol.for("@deepseek-ai/dsh-tools.scheduler")`

Patching only one copy does NOT work — either copy may provide the registry or
read it, and a `Symbol.for` key on one side still mismatches a plain `Symbol()`
on the other.

## Verify, then clean up

1. Remove any `[PROBE]` instrumentation lines added above.
2. Headless proof (isolated home so the running web host is untouched):
   ```sh
   export DSH_HOME="$(mktemp -d)" && cp ~/.dsh/settings.yaml "$DSH_HOME/"
   export ZAI_API_KEY="$(grep -oE 'ZAI_API_KEY=?["'"'"']?[A-Za-z0-9._-]+' ~/.zshrc | head -1 | sed -E 's/^ZAI_API_KEY=?["'"'"']?//')"
   pnpm dsh --profile headless "Use the bash tool to run: echo <tag> — then reply with exactly its output."
   ```
   Green = the reply is exactly the echoed tag.
3. Web profile: boot briefly with the isolated `DSH_HOME`; plugin activation
   must pass (an `EADDRINUSE` on the running host's port means plugins are
   healthy). Only then restart the real `pnpm dsh web`.

## Standing caveats

- `lib/` is a build artifact: re-apply the lib patch after every
  `pnpm run build`. The src patch dirties the tree across pulls — re-apply
  after checking out a new edition, drop when upstream adopts the fix.
- Never commit the patched files; this is a local unblock only.
- The error also litters the session ledger with orphan `tool/call` events
  (persisted before the throwing lookup). DeepSeek's endpoint rejects later
  turns of such sessions with a 400 (`tool_calls` must be followed by `tool`
  messages) — affected sessions are lost for that provider; start a new session
  rather than resuming.

## Retire this skill when

Upstream ships the key as `Symbol.for` (or otherwise guarantees singleton
resolution) in a tag this machine runs — verify with:
`git grep -n "Symbol.for('@deepseek-ai/dsh-tools.scheduler')" <tag> -- packages/core/tools/src/index.ts`,
then delete the repo copy and the mirror and note the retirement in the DSI
release KB note covering that jump.
