import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const dir = 'dev/specs/2026-09-14 - The Session Full Path';
const fail = [];
const ok = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) fail.push(name); };

// 4.1 files exist
const files = ['PRD.md', 'Tasks.md', 'karpathy-context.md', 'Tasks.json'].map(f => join(dir, f));
for (const f of files) ok('exists ' + f, existsSync(f));

const prd = readFileSync(files[0], 'utf8');
const tasks = readFileSync(files[1], 'utf8');
const json = JSON.parse(readFileSync(files[3], 'utf8'));

// 4.2 PRD mermaid: >=2, includes flowchart + sequenceDiagram
const blocks = [...prd.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(m => m[1]);
ok('PRD has >=2 mermaid blocks', blocks.length >= 2);
ok('PRD has flowchart', blocks.some(b => b.includes('flowchart')));
ok('PRD has sequenceDiagram', blocks.some(b => b.includes('sequenceDiagram')));
ok('no style directives in sequence blocks', blocks.every(b => !b.includes('flowchart') || !b.trim().startsWith('sequenceDiagram') ? true : !/style /.test(b)));

// 4.3 module maps
ok('PRD Module Map', prd.includes('### Module Map'));
ok('PRD Module Communication Map', prd.includes('### Module Communication Map'));
ok('PRD Shared Utilities Inventory', prd.includes('### Shared Utilities Inventory'));

// 4.4 directory structure verification per wave
ok('Wave 1 dir verification', tasks.includes('Directory structure verification (before starting)'));
ok('Wave 2 dir verification', tasks.includes('Directory structure verification:'));

// 4.5 public commitments
ok('Behavioral Commitments present', tasks.includes('⛔ Behavioral Commitments'));
ok('no private anti-pattern section', !tasks.includes('anti-pattern list'));

// 4.6 paired test tasks
// task lines: checkbox immediately followed by the task number (bold or bare); excludes DoD/commitment prose
const mdTasks = [];
for (const l of tasks.split('\n')) {
  const m = l.match(/^\s*- \[ \] \*{0,2}(\d+\.\d+)(-T)?\*{0,2} /);
  if (m) mdTasks.push(m[1] + (m[2] || ''));
}
// pairing rule: CODE-WRITING tasks only (1.x, 2.1, 2.2). 3.1 is itself a test task; 3.2 is documentation.
const codeTasks = mdTasks.filter(t => !t.endsWith('-T') && !t.startsWith('3.'));
const tests = new Set(mdTasks.filter(t => t.endsWith('-T')));
for (const c of codeTasks) ok('paired test for ' + c, tests.has(c + '-T'));

// 4.8 JSON counts match Tasks.md
const jTasks = json.waves.flatMap(w => w.tasks).map(t => t.taskNumber);
ok('JSON task count ' + jTasks.length + ' == MD count ' + mdTasks.length, jTasks.length === mdTasks.length);
ok('JSON task numbers match MD', JSON.stringify([...jTasks].sort()) === JSON.stringify([...mdTasks].sort()));
ok('JSON wave count matches MD waves', json.waves.length === (tasks.match(/^## Wave /gm) || []).length);

// slug assertion per deriveFeatureSlug algorithm
const folder = dir.split('/').pop();
const slug = folder.replace(/^\d{4}-\d{2}-\d{2}[- ]*/, '').toLowerCase().replace(/[ -]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
ok('featureSlug matches derived (' + slug + ')', json.featureSlug === slug);
ok('$schema literal', json.$schema === 'openclaw-insight/tasks-twin/v1');
ok('dependsOn refs valid', jTasks.filter(t => !t.endsWith('-T')).concat(jTasks).every(t => true) && json.waves.flatMap(w => w.tasks).every(t => t.dependsOn === null || jTasks.includes(t.dependsOn)));

console.log(fail.length ? 'FAILURES: ' + fail.length : 'ALL CHECKS PASS');
process.exit(fail.length ? 1 : 0);
