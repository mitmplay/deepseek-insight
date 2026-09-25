/**
 * FilesEditedCard unit tests (task 3.2-T, extended 2026-09-25 for the
 * chip-default + hover-diff contract — ADR The Edited-Files Card, D4
 * widened by operator request):
 *   - COLLAPSED chip by default; no fetch until expanded;
 *   - expand fetches the summary and renders rows with +/- counts;
 *   - binary/oversized markers replace counts; cap hint when capped;
 *   - an unavailable answer (410 / no session context) renders the
 *     count-less degraded strip — never fake counts;
 *   - hovering a row 1s fetches and renders that file's diff;
 *   - an unmount-raced response renders nothing stale.
 * fetch is stubbed at the global (the route itself is 2.2-T's subject).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FilesEditedHost from './FilesEditedHost.svelte';

const SUMMARY = {
	turn: 7,
	files: [
		{ path: 'src/a.ts', display: 'src/a.ts', added: 12, deleted: 3 },
		{ path: 'bin/data.db', display: 'bin/data.db', added: 0, deleted: 0, binary: true as const }
	],
	total: 5,
	added: 12,
	deleted: 3
};

const DIFF = {
	kind: 'text',
	path: 'src/a.ts',
	display: 'src/a.ts',
	before: true,
	after: true,
	coarse: false,
	hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' context', '+added line', '-removed line', ' context2'] }]
};

type Mounted = { target: HTMLElement; cleanup: () => void };

function mountCard(props: { sessionId?: string; turn: number; seq: number }): Mounted {
	const target = document.body.appendChild(document.createElement('div'));
	const comp = mount(FilesEditedHost, { target, props });
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

function expand(target: HTMLElement): void {
	(target.querySelector('[data-testid="files-edited-toggle"]') as HTMLElement).click();
	flushSync();
}

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(() => new Response(JSON.stringify({ ok: true, summary: SUMMARY }), { status: 200 }))
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('FilesEditedCard (task 3.2-T, chip-default contract)', () => {
	it('renders a COLLAPSED chip and fetches nothing until expanded', () => {
		const fetchSpy = vi.mocked(fetch);
		const { target, cleanup } = mountCard({ sessionId: 's1', turn: 7, seq: 41 });
		expect(target.querySelector('[data-testid="files-edited-toggle"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="files-edited-card"]')).toBeNull();
		expect(target.querySelector('[data-testid="files-edited-gone"]')).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
		cleanup();
	});

	it('expand fetches the summary and renders rows with +/- counts and the cap hint', async () => {
		const { target, cleanup } = mountCard({ sessionId: 's1', turn: 7, seq: 41 });
		expand(target);
		await vi.waitFor(() => {
			expect(target.querySelectorAll('[data-testid="files-edited-file"]')).toHaveLength(2);
		});
		const card = target.querySelector('[data-testid="files-edited-card"]')!;
		expect(card.textContent).toContain('Edited 5 files');
		expect(card.textContent).toContain('src/a.ts');
		expect(card.textContent).toContain('+12');
		expect(card.textContent).toContain('-3');
		expect(card.textContent).toContain('and 3 more');
		cleanup();
	});

	it('binary files show the marker, not counts', async () => {
		const { target, cleanup } = mountCard({ sessionId: 's1', turn: 7, seq: 41 });
		expand(target);
		await vi.waitFor(() => {
			expect(target.querySelectorAll('[data-testid="files-edited-file"]')).toHaveLength(2);
		});
		const row = target.querySelectorAll('[data-testid="files-edited-file"]')[1]!;
		expect(row.textContent).toContain('binary');
		expect(row.textContent).not.toContain('+0');
		cleanup();
	});

	it('an unavailable answer renders the degraded strip, never counts', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Response(JSON.stringify({ ok: false, error: { code: 'unavailable' } }), { status: 410 }))
		);
		const { target, cleanup } = mountCard({ sessionId: 's1', turn: 7, seq: 41 });
		expand(target);
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="files-edited-gone"]')).not.toBeNull();
		});
		expect(target.querySelector('[data-testid="files-edited-card"]')).toBeNull();
		cleanup();
	});

	it('no session context (standalone mount) degrades on expand', () => {
		const fetchSpy = vi.mocked(fetch);
		const { target, cleanup } = mountCard({ turn: 7, seq: 41 });
		expand(target);
		expect(target.querySelector('[data-testid="files-edited-gone"]')).not.toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
		cleanup();
	});

	it('hovering a row for 1s fetches the diff and mounts the house Monaco editor', async () => {
		const fetchSpy = vi.mocked(fetch);
		const { target, cleanup } = mountCard({ sessionId: 's1', turn: 7, seq: 41 });
		expand(target);
		await vi.waitFor(() => {
			expect(target.querySelectorAll('[data-testid="files-edited-file"]')).toHaveLength(2);
		});
		fetchSpy.mockClear();
		fetchSpy.mockResolvedValueOnce(
			new Response(JSON.stringify({ ok: true, diff: DIFF }), { status: 200 })
		);
		const row = target.querySelectorAll('[data-testid="files-edited-file"]')[0] as HTMLElement;
		row.dispatchEvent(new MouseEvent('mouseenter'));
		// highlight is immediate; the diff waits the full 1s hover
		expect(target.querySelector('[data-testid="files-edited-diff"]')).toBeNull();
		await new Promise((r) => setTimeout(r, 2100));
		// the real DiffView builds the unified rows from the initialized
		// DiffFile — added/removed lines render with their content
		const host = target.querySelector('[data-testid="files-edited-diff"]')!;
		await vi.waitFor(() => {
			expect(host.textContent).toContain('added line');
		});
		expect(host.textContent).toContain('removed line');
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(String(fetchSpy.mock.calls[0]![0])).toContain('index=0');
		cleanup();
	});

	it('a second hover rebuilds the vendor view with the new file (2026-09-25 blank-diff RCA)', async () => {
		// @git-diff-view/svelte's DiffView builds its rows ONCE at mount: a
		// new diffFile prop while mounted never rebuilds — the second hovered
		// row showed the first file's (or an empty) diff. FilesEditedDiff keys
		// the view on the diff object identity to force the rebuild.
		function diffFor(path: string, marker: string) {
			return {
				kind: 'text',
				path,
				display: path,
				before: true,
				after: true,
				coarse: false,
				// oldStart far beyond the window: the vendor patch parser aligned
				// the @@ start against the 1-line reconstructed content and rendered
				// ZERO rows (2026-09-25 blank-diff RCA) — the component must emit
				// window-relative headers.
				hunks: [{ oldStart: 169, oldLines: 1, newStart: 169, newLines: 1, lines: [`+${marker}`] }]
			};
		}
		const twoFiles = {
			turn: 7,
			files: [
				{ path: 'src/a.ts', display: 'src/a.ts', added: 1, deleted: 1 },
				{ path: 'src/b.ts', display: 'src/b.ts', added: 1, deleted: 1 }
			],
			total: 2,
			added: 2,
			deleted: 2
		};
		const fetchSpy = vi.fn((input: RequestInfo | URL) => {
			const url = String(input);
			const body = url.includes('index=0')
				? { ok: true, diff: diffFor('src/a.ts', 'alpha content') }
				: url.includes('index=1')
					? { ok: true, diff: diffFor('src/b.ts', 'beta content') }
					: { ok: true, summary: twoFiles };
			return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
		});
		vi.stubGlobal('fetch', fetchSpy);

		const { target, cleanup } = mountCard({ sessionId: 's1', turn: 7, seq: 41 });
		expand(target);
		await vi.waitFor(() => {
			expect(target.querySelectorAll('[data-testid="files-edited-file"]')).toHaveLength(2);
		});

		const rows = () => target.querySelectorAll('[data-testid="files-edited-file"]');
		rows()[0]!.dispatchEvent(new MouseEvent('mouseenter'));
		await new Promise((r) => setTimeout(r, 1300));
		const boxA = target.querySelector('[data-testid="files-edited-diff"]')!;
		expect(boxA.getAttribute('data-path')).toBe('src/a.ts');
		expect(boxA.textContent).toContain('alpha content');

		rows()[1]!.dispatchEvent(new MouseEvent('mouseenter'));
		await new Promise((r) => setTimeout(r, 1300));
		const boxB = target.querySelector('[data-testid="files-edited-diff"]')!;
		expect(boxB.getAttribute('data-path')).toBe('src/b.ts');
		expect(boxB.textContent).toContain('beta content');
		expect(boxB.textContent).not.toContain('alpha content');
		// the gutter carries the REAL file line numbers (169), not window-
		// relative fakes — the padded-window RCA fix, 2026-09-25
		expect(boxB.textContent).toContain('169');
		cleanup();
	});

	it('an unmount-raced summary response never renders stale', async () => {
		let resolveFetch: (r: Response) => void = () => {};
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }))
		);
		const { target, cleanup } = mountCard({ sessionId: 's1', turn: 7, seq: 41 });
		expand(target);
		cleanup(); // unmount before the answer lands
		resolveFetch(new Response(JSON.stringify({ ok: true, summary: SUMMARY }), { status: 200 }));
		await new Promise((r) => setTimeout(r, 10));
		expect(document.body.querySelector('[data-testid="files-edited-card"]')).toBeNull();
		expect(target.isConnected).toBe(false);
	});
});
