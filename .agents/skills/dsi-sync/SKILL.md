---
name: dsi-sync
description: Use when the user runs /dsi-sync or says to sync/mirror DeepSeek Insight (DSI) to its GitHub mirror — re-syncs ~/agentic-ai/deepseek-insight into ~/github/deepseek-insight (excluding dev/ and .git/), then commits and pushes the mirror. Covers resync, commit, push, and no-change skip.
---

# DSI → GitHub Mirror Sync

Mirror DSI into a publishable GitHub repo, then commit & push. The mirror lives at
`/Users/wharsojo/github/deepseek-insight` and has its own `.git` (origin:
`git@github.com:mitmplay/deepseek-insight.git`). Never touch the mirror's `.git`
or DSI's `dev/` folder.

## Source of truth

- SOURCE: `/Users/wharsojo/agentic-ai/deepseek-insight/`
- MIRROR: `/Users/wharsojo/github/deepseek-insight/`
- EXCLUDED from sync (always): `dev/`, `.git/`
- The mirror's own `.git` is protected because rsync excludes `.git/` — with
  `--delete`, excluded target paths are never deleted.

## 1. Re-sync

```bash
rsync -a --delete \
  --exclude 'dev/' \
  --exclude '.git/' \
  /Users/wharsojo/agentic-ai/deepseek-insight/ \
  /Users/wharsojo/github/deepseek-insight/
```

Trailing slashes matter: they copy CONTENTS of source into target, not the folder itself.

## 2. Verify the exclusions held

```bash
test -d /Users/wharsojo/github/deepseek-insight/dev && echo 'BAD: dev leaked' || echo 'ok: no dev'
test -d /Users/wharsojo/github/deepseek-insight/.git && echo 'ok: .git intact' || echo 'BAD: .git lost'
```

If either BAD line prints, stop and fix before committing — do not push a broken mirror.

## 3. Commit & push (skip if nothing changed)

```bash
cd /Users/wharsojo/github/deepseek-insight
git add -A
if git diff --cached --quiet; then
  echo 'no changes to sync'
else
  git commit -m "sync from DSI $(date +%Y-%m-%d %H:%M)"
  git push origin main
fi
```

- Always use `git add -A` then check the staged diff — never commit blind.
- Report to the user: file count changed (or "no changes"), commit hash, push result.
- If push is rejected (non-fast-forward), STOP and ask the user — never force-push
  without explicit approval.

## Failure handling

- `rsync` errors: report the failing path; do not commit a partial sync.
- Remote unreachable (SSH): report the error verbatim; the sync itself is still
  complete and committed locally.
- Mirror `.git` missing entirely: ask the user before re-initializing — do not
  invent a remote URL.
