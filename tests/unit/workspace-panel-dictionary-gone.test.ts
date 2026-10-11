/**
 * Clean-tree gate — The Last Dictionary W2 task 2.3-T (ADR 2026-10-08 D3).
 *
 * The retired workspacePanelCopy dictionary must have zero references in
 * src/: no import, no call site, no straggler file. Spec-folder docs and
 * the ADR that record the retirement are the intended audit trail and are
 * not scanned here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = resolveSrc();

function resolveSrc() {
	// tests/unit/*.{test}.ts → repo root is two levels up
	return join(import.meta.dirname, '..', '..', 'src');
}

function walk(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, acc);
		else acc.push(p);
	}
	return acc;
}

describe('workspacePanelCopy dictionary is fully retired (W2 2.3-T)', () => {
	it('zero references to workspacePanelCopy or workspace-panel-copy under src/', () => {
		const offenders: string[] = [];
		for (const file of walk(SRC)) {
			if (!/\.(svelte|ts|js|mjs)$/.test(file)) continue;
			// src/lib/paraglide is compiler output — it must never contain the name either.
			const text = readFileSync(file, 'utf8');
			if (/workspacePanelCopy|workspace-panel-copy/.test(text)) offenders.push(relative(SRC, file));
		}
		expect(offenders, 'files still referencing the retired dictionary').toEqual([]);
	});
});
