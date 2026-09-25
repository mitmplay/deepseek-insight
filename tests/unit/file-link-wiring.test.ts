/** File Link Intent W2.2 — the existence gate (workspaceFileExists):
 *  200 + basename → true; 404/403/transport → false; fragment stripped;
 *  root-level files probe the empty dir. */
import { describe, expect, it, vi } from 'vitest';
import { workspaceFileExists } from '../../src/lib/utils/file-link';

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
});
