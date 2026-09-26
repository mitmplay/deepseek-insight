/** File Link Intent W2.2 — the existence gate (workspaceFileExists):
 *  200 + basename → true; 404/403/transport → false; fragment stripped;
 *  root-level files probe the empty dir. */
import { describe, expect, it, vi } from 'vitest';
import { resolveFileLinkTarget, workspaceFileExists } from '../../src/lib/utils/file-link';

function treeResponder(entries: { name: string; type: string }[] | null, status = 200) {
	return vi.fn(async (input: RequestInfo | URL) => {
		if (status !== 200) return new Response('nope', { status });
		return new Response(JSON.stringify({ ok: true, listing: { entries: entries ?? [] } }), { status: 200 });
	}) as unknown as typeof fetch;
}

describe('workspaceFileExists gate (W2.2)', () => {
	it('200 with the basename in the dirname listing → true', async () => {
		const fetchImpl = treeResponder([
			{ name: 'a.ts', type: 'file' },
			{ name: 'FilesEditedCard.svelte', type: 'file' }
		]);
		await expect(workspaceFileExists('s1', 'src/lib/FilesEditedCard.svelte', fetchImpl)).resolves.toBe(true);
		expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('path=src%2Flib');
	});

	it('root-level file probes the empty dir path', async () => {
		const fetchImpl = treeResponder([{ name: 'README.md', type: 'file' }]);
		await expect(workspaceFileExists('s1', 'README.md', fetchImpl)).resolves.toBe(true);
		expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('path=');
	});

	it('basename absent → false', async () => {
		const fetchImpl = treeResponder([{ name: 'other.ts', type: 'file' }]);
		await expect(workspaceFileExists('s1', 'src/missing.ts', fetchImpl)).resolves.toBe(false);
	});

	it('404 and 403 refusals → false', async () => {
		await expect(workspaceFileExists('s1', 'src/a.ts', treeResponder(null, 404))).resolves.toBe(false);
		await expect(workspaceFileExists('s1', 'src/a.ts', treeResponder(null, 403))).resolves.toBe(false);
	});

	it('transport failure → false', async () => {
		const boom = (async () => {
			throw new Error('down');
		}) as unknown as typeof fetch;
		await expect(workspaceFileExists('s1', 'src/a.ts', boom)).resolves.toBe(false);
	});

	it('fragment stripped before the probe', async () => {
		const fetchImpl = treeResponder([{ name: 'Card.svelte', type: 'file' }]);
		await expect(workspaceFileExists('s1', 'src/Card.svelte#L153', fetchImpl)).resolves.toBe(true);
	});

	// Defense-in-depth (hardening 2026-09-26): the dot-dot fast-fail used to
	// live only in normalizeFileLinkPath — a direct gate call with a traversal
	// path fired a probe fetch before the host refused it. The gate now drops
	// it locally, with NO fetch at all.
	it('traversal paths → false with NO probe fetch', async () => {
		const fetchImpl = treeResponder([{ name: 'passwd', type: 'file' }]);
		await expect(workspaceFileExists('s1', '../etc/passwd', fetchImpl)).resolves.toBe(false);
		await expect(workspaceFileExists('s1', 'src/../../../etc/passwd', fetchImpl)).resolves.toBe(false);
		await expect(workspaceFileExists('s1', 'src/..%2F/etc', fetchImpl)).resolves.toBe(false); // literal segment, not traversal — host decides
		expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1); // only the literal one probed
	});
});

// ── Fullpath Bow ADR 2026-09-26 D1 — the floor's probe order ──

describe('resolveFileLinkTarget probe order (Fullpath Bow D1)', () => {
	const root = '/Users/op/agentic-ai/deepseek-insight';

	it('resolved candidate exists → published, ONE probe call', async () => {
		const exists = vi.fn(async (_s: string, p2: string) => p2 === 'src/lib/Composer.svelte');
		await expect(resolveFileLinkTarget('s1', root + '/src/lib/Composer.svelte', root, exists)).resolves.toBe(
			'src/lib/Composer.svelte'
		);
		expect(exists).toHaveBeenCalledTimes(1);
	});

	it('repo-folder prefix resolves and publishes', async () => {
		const exists = vi.fn(async (_s: string, p2: string) => p2 === 'src/lib/app.ts');
		await expect(resolveFileLinkTarget('s1', 'deepseek-insight/src/lib/app.ts', root, exists)).resolves.toBe(
			'src/lib/app.ts'
		);
		expect(exists).toHaveBeenCalledTimes(1);
	});

	it('resolved refuses → next candidate (first segment stripped) wins, bounded probes', async () => {
		// spine root above the session DSH root: 'src/real.ts' does not exist
		// at the spine-relative resolution, but 'real.ts' does (RCA 2026-09-26)
		const exists = vi.fn(async (_s: string, p2: string) => p2 === 'real.ts');
		await expect(resolveFileLinkTarget('s1', root + '/src/real.ts', root, exists)).resolves.toBe('real.ts');
		expect(exists).toHaveBeenCalledTimes(2);
		// order pinned: resolved candidate probed FIRST
		expect((exists as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toBe('src/real.ts');
		expect((exists as ReturnType<typeof vi.fn>).mock.calls[1]?.[1]).toBe('real.ts');
	});

	it('ALL candidates refuse → null with exactly the candidate count of probes', async () => {
		const exists = vi.fn(async () => false);
		await expect(resolveFileLinkTarget('s1', 'deepseek-insight/src/real.ts', root, exists)).resolves.toBeNull();
		expect(exists).toHaveBeenCalledTimes(3); // resolved, stripped, as-is
	});

	it('both refuse → null (the click drops)', async () => {
		const exists = vi.fn(async () => false);
		await expect(resolveFileLinkTarget('s1', 'nope/missing.ts', root, exists)).resolves.toBeNull();
	});

	it('workspace-relative path unchanged → single probe, no retry possible', async () => {
		const exists = vi.fn(async () => true);
		await expect(resolveFileLinkTarget('s1', 'src/a.ts', root, exists)).resolves.toBe('src/a.ts');
		expect(exists).toHaveBeenCalledTimes(1);
	});
});
