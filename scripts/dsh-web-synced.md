# dsh-web-synced

Run `dsh web` with DSI's launch token kept in sync while the server runs..

## The problem it solves

DSH's `?token=` launch token is keyed to the **root Cordis context**, not the OS
process. Whenever the running server reboots its plugin tree — a
self-modification reload, a bundle/patch change — the **same process on the same
port** mints a **new** token and prints the URL line again in the terminal.
DSI, which stores `dsh.authToken` in `~/.dsi/settings.yaml`, keeps
retrying with the stale value and fails honest.

DSI re-reads `dsh.authToken` from disk on **every** 401 retry (no cache), so
rewriting the settings file is the whole fix — no DSI restart. This script is
that rewrite: each `dsh web: http://…token=…` line on the server's stdout
updates the file within the same second the server re-announces.

## Usage

```sh
# from any directory — the script locates both checkouts itself
~/agentic-ai/deepseek-insight/scripts/dsh-web-synced.sh --no-open
```

Use it **instead of** `pnpm dsh web`. Every `dsh web` flag passes through:

```sh
scripts/dsh-web-synced.sh                    # opens the browser, like dsh web
scripts/dsh-web-synced.sh --no-open          # headless terminal
scripts/dsh-web-synced.sh --port 3080        # explicit port
```

On each token line you will see:

```
dsh web: http://127.0.0.1:3080/?token=…
dsh-web-synced: authToken updated in /Users/<you>/.dsi/settings.yaml
```

DSI heals itself on its next request — the first 401 after a token rotation
re-mints the session cookie with the fresh token.

## Configuration

| Setting | Value |
|---|---|
| Settings file | `$DSI_CONFIG_PATH`, default `~/.dsi/settings.yaml` |
| Section updated | `dsh.authToken` (nothing else in the file is touched) |
| DSH checkout | sibling `deepseek-harness` directory (resolved from the script location) |
| YAML library | loaded from DSI's own `node_modules` (`yaml`) |

## What it does not do

- It does **not** restart DSI, DSH, or a browser tab.
- It does **not** persist the session cookie. The cookie already survives tree
  reboots (the signing secret is durable); only the launch token rotates.
- It cannot recover a token the server never printed — if the process crashes
  before announcing, restart the script.

## Testing

The script honors `DSI_CONFIG_PATH` (the same test seam DSI's config reader
uses), so it can be exercised without touching the real settings:

```sh
cp ~/.dsi/settings.yaml /tmp/dsi-test-settings.yaml
DSI_CONFIG_PATH=/tmp/dsi-test-settings.yaml \
  scripts/dsh-web-synced.sh --no-open --port 3999
# → verify the token printed on stdout equals dsh.authToken in /tmp/dsi-test-settings.yaml
```

## See also

- `src/lib/server/insight-config.ts` — `readDshAuthConfig` (the no-cache reader)
- `src/lib/server/dsh-connection.ts` — the 401 → re-mint retry path
- DSH `packages/client/connection/src/browser-auth.ts` — why the token is
  per-root-context and never written to disk
