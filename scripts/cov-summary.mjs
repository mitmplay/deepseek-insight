// Print per-file coverage pct + uncovered branch lines from coverage-final.json
import { readFileSync, existsSync } from 'node:fs';
const p = process.argv[2] ?? 'coverage/coverage-final.json';
if (!existsSync(p)) {
  console.error('missing ' + p);
  process.exit(1);
}
const c = JSON.parse(readFileSync(p, 'utf-8'));
const pct = (a) => Math.round((100 * a.filter((x) => x > 0).length) / Math.max(1, a.length));
for (const [f, v] of Object.entries(c)) {
  const miss = [];
  for (const [id, br] of Object.entries(v.branchMap)) {
    v.b[id].forEach((n, j) => {
      if (n === 0) miss.push(br.loc.start.line + ':' + j);
    });
  }
  console.log(
    f.split('src/')[1],
    'stmts', pct(Object.values(v.s ?? {})) + '%',
    'branch', pct(Object.values(v.b ?? {}).flat()) + '%',
    'funcs', pct(Object.values(v.f ?? {})) + '%',
    'lines', pct(Object.values(v.l ?? {})) + '%'
  );
  if (miss.length) console.log('  miss:', miss.join(','));
}
