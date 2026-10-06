# allowBuilds — snippet shapes and the placeholder trap

Where: `~/.dsh/profiles/web/pnpm-workspace.yaml` (host profile) and the
SOURCE REPO's own `pnpm-workspace.yaml` (for git-hosted packages — their
prepare runs under their own allowlist).

## Shapes that work (pnpm 11.7)

```yaml
allowBuilds:
  # plain package name (local deps, transitive builds)
  esbuild: true
  node-pty: true
  # git-hosted package, exact tarball sha — what the error prints verbatim
  "@deepseek-insight/dsi@https://codeload.github.com/mitmplay/deepseek-insight/tar.gz/de43c9658dd2bc4221b116fc1420be167facb353": true
  # wildcard bet — cover future shas of the same repo
  "@deepseek-insight/dsi@https://codeload.github.com/mitmplay/**": true
```

Keys with `: ` or spaces in them MUST be quoted.

## The placeholder trap (armed twice, 2026-10-06)

Both of these shipped in real yaml files and LOOK set while blocking:

```yaml
esbuild: set this to true or false   # a string, not a boolean — pnpm treats it as not-allowed
node-pty: set this to true or false
```

Pre-flight grep — run against BOTH homes before any install:

```bash
grep -rn 'set this to true' \
  ~/.dsh/profiles/web/pnpm-workspace.yaml \
  <source-repo>/pnpm-workspace.yaml && echo 'PLACEHOLDER FOUND — fix before installing'
```

## The sha treadmill (git-hosted packages)

For a git tarball, pnpm's identity for the package embeds the commit sha, so
the exact key expires with the next release of that repo:

1. Fix anything in the source repo → commit → push → mirror.
2. The mirror's new HEAD is the new sha — ADD a new exact key for it (keep
   the old ones; they are inert).
3. Keep the wildcard entry too; if pnpm honors it, future releases need
   nothing (unproven as of 2026-10-06 — the exact key remains the fallback).

## pnpmapprove-builds note

`pnpm approve-builds` exists as the interactive alternative, but the
skill's path is hand-editing the yaml: the profile's file lives outside any
git repo and the edit is one line. Commit source-repo allowlist fixes
normally (they are real repo changes — d67419a is the exemplar).
