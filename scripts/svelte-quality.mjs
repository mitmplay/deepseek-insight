#!/usr/bin/env node
// ADR-0018 D3 quality gate: run svelte-autofixer on git-touched Svelte files.
// Zero autofixer ISSUES required (suggestions are advisory — justify in PR).
// Justified exemptions (each names its reason; remove when the reason goes):
// - "replaceState() call without resolve()": pairing requires $app/navigation's
//   resolve(), which @sveltejs/kit 2.70.3 ships in its public types but NOT
//   in the runtime module — the fix is impossible until the kit upgrade.
//   (Spec: Component Standard Enforcement W2 completion notes, 2026-10-09.)
//
//   node scripts/svelte-quality.mjs              # touched files vs HEAD
//   node scripts/svelte-quality.mjs <file...>    # explicit files
//   node scripts/svelte-quality.mjs --list       # print touched files, exit 0
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SVELTE_RE = /\.(svelte|svelte\.ts|svelte\.js)$/;

/** @param {string} [baseRef] */
export function touchedSvelteFiles(baseRef = 'HEAD') {
  let out;
  try {
    out = execFileSync('git', ['diff', '--name-only', baseRef], { encoding: 'utf8' });
  } catch {
    out = execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' });
  }
  // untracked too — brand-new files are exactly where drift starts
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
  return [...new Set([...out.split('\n'), ...untracked.split('\n')])]
    .map((s) => s.trim()).filter((s) => s && SVELTE_RE.test(s) && !s.startsWith('tests/fixtures/'));
}

const JUSTIFIED_ISSUES = [
  'Unexpected replaceState() call without resolve().'
];

/**
 * @param {string} file
 * @returns {{ file: string, error?: string, issues?: string[], justified?: number }}
 */
export function runAutofixer(file) {
  const r = spawnSync('npx', ['-y', '@sveltejs/mcp', 'svelte-autofixer', file], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0 && !r.stdout) return { file, error: (r.stderr || 'autofixer failed').slice(0, 400) };
  try {
    // the CLI prints a preamble line then a JS-ish object with unquoted keys —
    // not strict JSON; evaluate the object literal from our own tool output
    const src = r.stdout.slice(r.stdout.indexOf('{'));
    /** @type {{ issues?: string[] }} */
    const json = new Function('return (' + src + ')')();
    const issues = (json.issues ?? []).filter((i) => !JUSTIFIED_ISSUES.some((j) => String(i).startsWith(j)));
    const justified = (json.issues ?? []).length - issues.length;
    return { file, issues, justified };
  } catch {
    return { file, error: 'unparseable autofixer output' };
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--list') {
    console.log(touchedSvelteFiles().join('\n'));
    process.exit(0);
  }
  const targets = argv.length ? argv : touchedSvelteFiles();
  if (!targets.length) {
    console.log('svelte-quality: no touched Svelte files — gate passes');
    process.exit(0);
  }
  console.log('svelte-quality: checking ' + targets.length + ' file(s)...');
  let failed = 0;
  for (const f of targets) {
    const res = runAutofixer(f);
    if (res.error) { console.error('ERROR  ' + f + ': ' + res.error); failed++; continue; }
    if (res.issues?.length) {
      console.error('ISSUES ' + f + ' (' + res.issues.length + '):');
      for (const i of res.issues) console.error('   - ' + i);
      failed++;
    } else {
      console.log('clean  ' + f);
    }
  }
  console.log(failed ? 'svelte-quality: FAILED (' + failed + ' file(s) with issues)' : 'svelte-quality: PASSED');
  process.exit(failed ? 1 : 0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
