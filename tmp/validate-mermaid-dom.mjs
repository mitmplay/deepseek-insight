const stub = { addHook() {}, sanitize(t) { return t; } };
globalThis.DOMPurify = stub;
globalThis.window = globalThis.window || { DOMPurify: stub };
const mermaid = (await import('mermaid')).default;
const file = process.argv[2];
const { readFileSync } = await import('node:fs');
const text = readFileSync(file, 'utf8');
const blocks = [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
let bad = 0;
for (const [i, b] of blocks.entries()) {
  try { await mermaid.parse(b); console.log(`block ${i + 1}: OK`); }
  catch (e) { console.error(`block ${i + 1}: FAIL`, e.message.slice(0, 120)); bad++; }
}
process.exit(bad ? 1 : 0);
