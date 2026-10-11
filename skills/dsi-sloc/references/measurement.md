# Measurement Reference — Raw-Code SLOC in DSI

How to count SLOC excluding comments and blank lines, per file, in this repo.

## The metric

- **Raw-code SLOC** = physical lines minus blank lines minus comment lines (the `sloc` npm package's `source` key).
- **Why not `wc -l`**: DSI's comment+blank density is ~35% (measured 2026-10-10: 39,402 raw out of ~60,670 physical). Ranking by `wc -l` promotes comment-heavy files and hides dense ones.
- `*.svelte` files are analyzed as JS (the analyzer has no Svelte grammar; template markup counts as code). State this in the report methodology line.

## Tooling gotchas (learned the hard way, 2026-10-10)

1. `npx -y sloc` (the CLI) prints only an AGGREGATE — useless for ranking. You need per-file counts.
2. `npx -y -p sloc node script.mjs` does **NOT** make `sloc` importable from the script — the npx install tree is not on the script's module resolution path (`ERR_MODULE_NOT_FOUND`).
3. **Working pattern**: create a temp env and install into it, then run the script from the project root (the script walks relative paths, so cwd matters):

```bash
mkdir -p tmp/slocenv
cp tmp/sloc-raw.mjs tmp/slocenv/          # script shown below
cd tmp/slocenv && npm init -y >/dev/null && npm i sloc >/dev/null && cd ../..
node tmp/slocenv/sloc-raw.mjs
```

4. The `sloc` package is CommonJS; under ESM import both the default and the named exports defensively:

```js
import slocMod from 'sloc';
const sloc = slocMod.default ?? slocMod;
const getLang = slocMod.getLang ?? slocMod.default?.getLang ?? (() => null);
```

## The per-file script (`tmp/sloc-raw.mjs`)

```js
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import slocMod from 'sloc';
const sloc = slocMod.default ?? slocMod;
const getLang = slocMod.getLang ?? slocMod.default?.getLang ?? (() => null);

const roots = ['src/lib', 'bin', 'scripts', 'plugins'];   // adjust scope per invocation
const exts = ['.svelte', '.ts', '.js', '.mjs'];
const out = [];

function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'paraglide' || e.name === '.svelte-kit') continue;  // generated
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (exts.includes(extname(e.name))) {
      const lang = extname(e.name) === '.svelte' ? 'js' : (getLang(extname(e.name).slice(1)) || 'js');
      out.push({ p, n: sloc(readFileSync(p, 'utf8'), lang).source });
    }
  }
}
roots.forEach(walk);
out.sort((a, b) => b.n - a.n);
for (const f of out.filter(f => f.n > 500)) console.log(String(f.n).padStart(6), f.p);
console.log('---');
console.log('files:', out.length, 'total raw SLOC:', out.reduce((s, f) => s + f.n, 0));
```

To also capture TOTAL lines per file (the report's second column), add `total: c.split('\n').length` alongside `n`.

## Scope rules

| Include | Exclude |
|---|---|
| `src/lib/**` (.svelte, .ts, .svelte.ts) | `src/lib/paraglide/**` (generated i18n) |
| `bin/**`, `scripts/**`, `plugins/**` | `.svelte-kit/**`, `build/**`, `node_modules/**` |
| `.mjs` tooling scripts | `static/**`, `messages/**`, docs and specs |

Extend `roots` when the user asks for a different scope; never silently include generated code.

## Interpreting the two columns

- **raw ≈ total** → the file is dense logic (few comments) — size is real complexity.
- **raw << total** → comments/markup dominate — check whether the `wc -l` impression was misleading (Svelte components commonly halve).
- The gap itself is a report finding; state it in the Patterns section.
