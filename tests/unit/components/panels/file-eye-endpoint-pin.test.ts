/**
 * File Eye task 4.1-T: the retired delegate stays retired — the panel's
 * save endpoint is the gated direct-write route, and the retired files
 * have zero code references (spec/ADR audit trail excluded).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import WorkspaceFilePanel from '$lib/components/panels/WorkspaceFilePanel.svelte';

describe('File Eye — the delegate stays retired (4.1-T)', () => {
	it('the panel saves through /api/workspace/file-write', () => {
		const src = readFileSync('src/lib/components/panels/WorkspaceFilePanel.svelte', 'utf8');
		expect(src).toContain('/api/workspace/file-write');
		expect(src).not.toContain('/api/dsh/workspace-file/save');
	});

	it('zero CODE references to the retired delegate (docs excluded)', () => {
		const out = execSync(
			"grep -rln 'delegated-save\|workspace-file/save' src/ tests/ scripts/ 2>/dev/null || true",
			{ encoding: 'utf8', cwd: process.cwd() }
		);
		const hits = out.split('\n').filter((l) => l.trim().length > 0);
		// The only allowed hit: this very test's grep string lives in tests/.
		const real = hits.filter((h) => !h.includes('file-eye-endpoint-pin.test.ts'));
		expect(real).toEqual([]);
	});
});
