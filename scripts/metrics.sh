#!/usr/bin/env bash
# Reproduces the Evidence table of ADR-0001 ("2026-08-20 - Read the Harness's Own Memory, Not Its Whole Source") from a deepseek-harness checkout.
# Usage: scripts/metrics.sh [path-to-harness]   (default: sibling ../deepseek-harness)
set -euo pipefail

HARNESS="${1:-$(cd "$(dirname "$0")/../.." && pwd)/deepseek-harness}"
if [ ! -d "$HARNESS/.git" ]; then
  echo "error: $HARNESS is not a git checkout of deepseek-harness" >&2
  exit 1
fi

cd "$HARNESS"
commit=$(git rev-parse --short HEAD)
date=$(git log -1 --format=%ci | cut -d' ' -f1)

count() { find "$@" 2>/dev/null | wc -l | tr -d ' '; }

printf 'Harness: %s @ %s (%s)\n\n' "$HARNESS" "$commit" "$date"
printf '| Artifact | Count |\n|---|---|\n'
printf '| Workspace packages | %s |\n' "$(find packages -mindepth 3 -maxdepth 3 -name package.json | wc -l | tr -d ' ')"
printf '| Package groups | %s |\n' "$(ls -d packages/*/ | wc -l | tr -d ' ')"
printf '| Vendored Cordis packages | %s |\n' "$(find vendor -name package.json -not -path '*/node_modules/*' | wc -l | tr -d ' ')"
printf '| TypeScript files (packages/**) | %s |\n' "$(find packages -name '*.ts' -not -path '*/node_modules/*' -not -path '*/lib/*' | wc -l | tr -d ' ')"
printf '| Lines of TS (packages/**/src) | %s |\n' "$(find packages -path '*/src/*.ts' -not -path '*/node_modules/*' -print0 | xargs -0 cat | wc -l | tr -d ' ')"
printf '| Agent notes (.agents/notes/**.md) | %s |\n' "$(count .agents/notes -name '*.md')"
printf '| …in implemented/ | %s |\n' "$(count .agents/notes/implemented -name '*.md')"
printf '| Docs markdown (docs/**.md) | %s |\n' "$(count docs -name '*.md')"
printf '| Repo gates & generators (scripts/) | %s |\n' "$(find scripts -type f | wc -l | tr -d ' ')"
printf '| Reusable agent skills (.agents/skills/) | %s |\n' "$(ls .agents/skills/ 2>/dev/null | wc -l | tr -d ' ')"
printf '| AGENTS.md size (bytes) | %s |\n' "$(wc -c < AGENTS.md | tr -d ' ')"
