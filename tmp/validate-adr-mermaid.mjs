import { readFileSync } from 'node:fs';
const mermaid = (await import('mermaid')).default;
const file = process.argv[2];
const text = readFileSync(file, 'utf8');
const blocks = [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
if (blocks.length === 0) { console.log('no mermaid blocks'); process.exit(0); }
for (const [i, b] of blocks.entries()) {
  try { await mermaid.parse(b); console.log(`block ${i + 1}: OK`); }
  catch (e) { console.error(`block ${i + 1}: FAIL`, e.message); process.exit(1); }
}
