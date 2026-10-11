import { describe, it, expect } from 'vitest';
import { touchedSvelteFiles, runAutofixer } from '../../scripts/svelte-quality.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(__dirname, '../..');

describe('svelte-quality sweep (ADR-0018 D3)', () => {
  it('touched-file lister returns only svelte-family paths (skips everything else)', () => {
    const files = touchedSvelteFiles();
    const re = /\.(svelte|svelte\.ts|svelte\.js)$/;
    for (const f of files) expect(f).toMatch(re);
    expect(Array.isArray(files)).toBe(true);
  });

  it('runAutofixer reports issues for a file with a mutable built-in', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sq-'));
    const file = join(dir, 'Bad.svelte');
    writeFileSync(file, '<script lang="ts">\n  export let name: string;\n</script>\n<p>{name}</p>\n');
    try {
      const res = runAutofixer(file);
      expect(res.error).toBeUndefined();
      expect((res.issues ?? []).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 150_000);

  it('runAutofixer reports zero issues for a clean file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sq-'));
    const file = join(dir, 'Good.svelte');
    writeFileSync(file, '<script lang="ts">\n  let { name = "world" }: { name?: string } = $props();\n</script>\n<p>hello {name}</p>\n');
    try {
      const res = runAutofixer(file);
      expect(res.error).toBeUndefined();
      expect(res.issues).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 150_000);
});
