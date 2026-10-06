# Verification — prove the mount, not the install

Two layers: OFFLINE composition (no restart needed) and LIVE RPC (needs the
restarted host). The offline dump proves the tree composes; only the live RPC
proves the preset mounts healthy — do both.

## 1. Offline composition dump (any time)

```bash
dsh --profile web --dump-config 2>&1 | grep -n 'preset-<id>\|id: <preset-id>'
```

- Found → the bundle patch composes into the tree.
- Absent → the bundle is not in `dsh.profile.bundles`, or its patch failed to
  load — check the manifest's bundles array FIRST (the clobber), then the
  patch file.

## 2. Mint a session cookie (live RPC auth)

The launch token is kept fresh in `~/.dsi/settings.yaml` key
`dsh.authToken` by `scripts/dsh-web-synced.sh` (it rewrites the file each
time the host re-announces its URL). Exchange token → cookie:

```bash
TOK=$(grep -A2 '^dsh:' ~/.dsi/settings.yaml | grep authToken | sed 's/.*authToken: *//')
C=$(curl -s -i --max-time 5 "http://127.0.0.1:3080/?token=$TOK" -D - -o /dev/null \
  | grep -i '^set-cookie' | head -1 | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)
```

A 401 here means a stale token (host restarted without the synced script)
— reopen the URL `dsh web` printed, or rerun the synced launcher.

## 3. Live preset health — agentPresets/list

Wire: POST `{base}/api/{method}` with a `client-request` envelope whose
payload wraps ONE plain-object `args` field (gateway rejects otherwise):

```bash
curl -s --max-time 20 -X POST \
  -H "Cookie: $C" -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"r1","method":"agentPresets/list","payload":{"args":{}}}' \
  http://127.0.0.1:3080/api/agentPresets/list
```

PASS: `result.ok: true` and every preset lacks a `broken` key.
FAIL: the preset carries `broken: "<reason>"` — that string is the root
cause verbatim (registry sets it at mount,
`dsh-agent-preset-registry/lib/index.js:517-518`). The settings badge shows
only a generic label; the wire keeps the reason.

Known failures and their reasons:

| broken reason | fix |
|---|---|
| `<plugin>: never started` | the plugin row names a plugin this runtime no longer starts — diff against the shipped preset, swap the row |
| `Preset services require isolate realms: <realm>` | move the consuming row INSIDE the group that declares the realm |
| (badge-only, no reason) | composition never mounted the preset — check bundles array |

## 4. Rack reconciliation (panel truth)

```bash
node ~/.agents/skills/dsi-plugin-rack/rack.mjs refresh --reload
```

Every reff row must agree with reality (installed flag + `pkg`), zero
`errors`. This rewrites the snapshot cache the plugin panel reads — the UI
heals on its next fetch, no restart.
