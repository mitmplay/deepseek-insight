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

	// ── Coverage extensions (2026-09-26): the defensive arms ──

	it('oversized files show the oversized marker, not counts', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				new Response(
					JSON.stringify({
						ok: true,
						summary: {
							turn: 7,
							files: [
								{ path: 'src/a.ts', display: 'src/a.ts', added: 1, deleted: 1 },
								{ path: 'big/blob', display: 'big/blob', added: 0, deleted: 0, oversized: true as const }
							],
							total: 2,
							added: 1,
							deleted: 1
						}
					}),
					{ status: 200 }
				)
			)
		);
		const { target, cleanup } = mountCard({ sessionId: 's1', turn: 7, seq: 41 });
		expand(target);
		await vi.waitFor(() => {
			expect(target.querySelectorAll('[data-testid="files-edited-file"]')).toHaveLength(2);
		});
		const row = target.querySelectorAll('[data-testid="files-edited-file"]')[1]!;
		expect(row.textContent).toContain('too large'); // the oversized marker copy
		expect(row.textContent).not.toContain('+0');
		cleanup();
	});

	it('a hover LEFT before the 1s mark never fetches a diff (rowLeave clears the timer)', async () => {
		const fetchSpy = vi.mocked(fetch);
		const { target, cleanup } = mountCard({ sessionId: 's1', turn: 7, seq: 41 });
		expand(target);
		await vi.waitFor(() => {
			expect(target.querySelectorAll('[data-testid="files-edited-file"]')).toHaveLength(2);
		});
		fetchSpy.mockClear();
		const row = target.querySelectorAll('[data-testid="files-edited-file"]')[0] as HTMLElement;
		row.dispatchEvent(new MouseEvent('mouseenter'));
		row.dispatchEvent(new MouseEvent('mouseleave'));
		await new Promise((r) => setTimeout(r, 1300));
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(target.querySelector('[data-testid="files-edited-diff"]')).toBeNull();
		cleanup();
	});

	it('a summary fetch that REJECTS at transport level degrades to the gone strip', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('network down'))));
		const { target, cleanup } = mountCard({ sessionId: 's1', turn: 7, seq: 41 });
		expand(target);
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="files-edited-gone"]')).not.toBeNull();
		});
		expect(target.querySelector('[data-testid="files-edited-card"]')).toBeNull();
		cleanup();
	});

	it('a diff fetch that REJECTS clears the loading indicator, never crashes', async () => {
		const fetchSpy = vi.fn((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('index=0')) return Promise.reject(new TypeError('diff transport error'));
			return Promise.resolve(new Response(JSON.stringify({ ok: true, summary: SUMMARY }), { status: 200 }));
		});
		vi.stubGlobal('fetch', fetchSpy);
		const { target, cleanup } = mountCard({ sessionId: 's1', turn: 7, seq: 41 });
		expand(target);
		await vi.waitFor(() => {
			expect(target.querySelectorAll('[data-testid="files-edited-file"]')).toHaveLength(2);
		});
		const row = target.querySelectorAll('[data-testid="files-edited-file"]')[0] as HTMLElement;
		row.dispatchEvent(new MouseEvent('mouseenter'));
		await new Promise((r) => setTimeout(r, 1300));
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="files-edited-diff-loading"]')).toBeNull();
		});
		expect(target.querySelector('[data-testid="files-edited-diff"]')).toBeNull();
		cleanup();
	});

	it('binary and oversized DIFFS render their marker lines instead of the vendor view', async () => {
		for (const kind of ['binary', 'oversized'] as const) {
			const fetchSpy = vi.fn((input: RequestInfo | URL) => {
				const url = String(input);
				if (url.includes('index=0')) {
					return Promise.resolve(new Response(JSON.stringify({ ok: true, diff: { kind } }), { status: 200 }));
				}
				return Promise.resolve(new Response(JSON.stringify({ ok: true, summary: SUMMARY }), { status: 200 }));
			});
			vi.stubGlobal('fetch', fetchSpy);
			const { target, cleanup } = mountCard({ sessionId: 's1', turn: 7, seq: 41 });
			expand(target);
			await vi.waitFor(() => {
				expect(target.querySelectorAll('[data-testid="files-edited-file"]')).toHaveLength(2);
			});
			const row = target.querySelectorAll('[data-testid="files-edited-file"]')[0] as HTMLElement;
			row.dispatchEvent(new MouseEvent('mouseenter'));
			await new Promise((r) => setTimeout(r, 1300));
			const card = target.querySelector('[data-testid="files-edited-card"]')!;
			await vi.waitFor(() => {
				expect(card.textContent).toContain(kind === 'binary' ? 'binary' : 'too large');
			});
			expect(target.querySelector('[data-testid="files-edited-diff"]')).toBeNull();
			cleanup();
		}
	});

	it('a STALE hover answer (resolved after a newer hover) renders nothing of its own', async () => {
		const pending = new Map<string, (r: Response) => void>();
		const fetchSpy = vi.fn((input: RequestInfo | URL) => {
			const url = String(input);
			const key = url.includes('index=') ? url.match(/index=(\d)/)![1]! : 'summary';
			if (key === 'summary') {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, summary: SUMMARY }), { status: 200 }));
			}
			return new Promise<Response>((resolve) => pending.set(key, resolve));
		});
		vi.stubGlobal('fetch', fetchSpy);
		const { target, cleanup } = mountCard({ sessionId: 's1', turn: 7, seq: 41 });
		expand(target);
		await vi.waitFor(() => {
			expect(target.querySelectorAll('[data-testid="files-edited-file"]')).toHaveLength(2);
		});
		const rows = () => target.querySelectorAll('[data-testid="files-edited-file"]');
		// hover row 0 → fetch ticket 1 in flight
		rows()[0]!.dispatchEvent(new MouseEvent('mouseenter'));
		await new Promise((r) => setTimeout(r, 1300));
		// hover row 1 → fetch ticket 2 in flight (ticket 1 is now stale)
		rows()[1]!.dispatchEvent(new MouseEvent('mouseenter'));
		await new Promise((r) => setTimeout(r, 1300));
		// answer the NEWER ticket first
		pending.get('1')!(new Response(JSON.stringify({ ok: true, diff: { kind: 'text', path: 'src/b.ts', display: 'src/b.ts', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['+fresh'] }] } }), { status: 200 }));
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="files-edited-diff"]')).not.toBeNull();
		});
		// the STALE ticket lands late — it must not repaint the view
		pending.get('0')!(new Response(JSON.stringify({ ok: true, diff: { kind: 'text', path: 'src/a.ts', display: 'src/a.ts', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['+stale'] }] } }), { status: 200 }));
		await new Promise((r) => setTimeout(r, 30));
		expect(target.querySelector('[data-testid="files-edited-diff"]')!.getAttribute('data-path')).toBe('src/b.ts');
		expect(target.querySelector('[data-testid="files-edited-diff"]')!.textContent).toContain('fresh');
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
