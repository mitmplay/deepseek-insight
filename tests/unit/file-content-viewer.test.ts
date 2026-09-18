/**
 * FileContentViewer unit tests — typed rendering of a read result's
 * file window. Direct mount with small DsiReadView fixtures
 * (inline-tool-calls.test.ts mounts it only indirectly through
 * InlineToolCalls; this suite pins the viewer's own branches):
 *
 *  - header: copy affordance, filename basename, and the honest window
 *    count ("lines X–Y of Z") vs the whole-file count ("N lines"),
 *    including the empty-window edge
 *  - body typing: markdown family → prose; known code lang →
 *    highlighted pre; unknown/absent lang → plain pre
 *  - bounded render: a >400-line window grows the toggle, and the
 *    toggle flips expanded ↔ collapsed
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import FileContentViewer from '$lib/components/message/FileContentViewer.svelte';
import type { DsiReadLine, DsiReadView } from '$lib/types';

function line(number: number, text = `line ${number}`): DsiReadLine {
	return { number, text };
}

function view(over: Partial<DsiReadView>): DsiReadView {
	return {
		path: '/tmp/harness/file.txt',
		lang: undefined,
		offset: 1,
		totalLines: 1,
		lines: [],
		...over
	};
}

function mountView(v: DsiReadView) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(FileContentViewer, { target, props: { view: v } });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('FileContentViewer — header', () => {
	it('renders the shell, the copy affordance, and the path basename', () => {
		const { target, instance } = mountView(view({ path: '/tmp/harness/src/app.ts', lines: [line(1)] }));
		expect(target.querySelector('[data-testid="file-content-viewer"]')).not.toBeNull();
		const header = target.querySelector('[data-testid="file-viewer-header"]') as HTMLElement;
		expect(header).not.toBeNull();
		// The CopyButton rides the header (copy full path affordance).
		expect(header.querySelector('button')).not.toBeNull();
		expect(header.textContent).toContain('app.ts');
		expect(header.querySelector('[title="/tmp/harness/src/app.ts"]')).not.toBeNull();
		unmount(instance);
	});

	it('a partial window shows its offset honestly: "lines 3–5 of 10"', () => {
		const { target, instance } = mountView(
			view({ lines: [line(3), line(4), line(5)], offset: 3, totalLines: 10 })
		);
		expect(target.querySelector('[data-testid="file-viewer-header"]')?.textContent).toContain(
			'lines 3–5 of 10'
		);
		unmount(instance);
	});

	it('a whole-file window shows the plain count: "4 lines"', () => {
		const { target, instance } = mountView(
			view({ lines: [line(1), line(2), line(3), line(4)], totalLines: 4 })
		);
		expect(target.querySelector('[data-testid="file-viewer-header"]')?.textContent).toContain(
			'4 lines'
		);
		unmount(instance);
	});

	it('an empty window falls back to the whole-file count', () => {
		const { target, instance } = mountView(view({ lines: [], offset: 5, totalLines: 7 }));
		const header = target.querySelector('[data-testid="file-viewer-header"]')?.textContent ?? '';
		expect(header).toContain('7 lines');
		expect(header).not.toContain('lines –');
		unmount(instance);
	});
});

describe('FileContentViewer — body typing', () => {
	it('markdown family (.md lang) renders prose, not code', () => {
		const { target, instance } = mountView(
			view({ path: 'README.md', lang: 'md', lines: [line(1, '# Title')], totalLines: 1 })
		);
		expect(target.querySelector('[data-testid="file-viewer-markdown"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="file-viewer-code"]')).toBeNull();
		unmount(instance);
	});

	it('.mdx path (no lang hint) still renders the markdown family', () => {
		const { target, instance } = mountView(
			view({ path: 'docs/notes.mdx', lines: [line(1, 'prose')], totalLines: 1 })
		);
		expect(target.querySelector('[data-testid="file-viewer-markdown"]')).not.toBeNull();
		unmount(instance);
	});

	it('a known code lang renders the highlighted code pane', () => {
		const { target, instance } = mountView(
			view({ path: 'app.ts', lang: 'ts', lines: [line(1, 'const x = 1;')], totalLines: 1 })
		);
		const code = target.querySelector('[data-testid="file-viewer-code"] code.hljs');
		expect(code).not.toBeNull();
		expect(target.querySelector('[data-testid="file-viewer-plain"]')).toBeNull();
		// The lang hint rides the shell attribute.
		expect(
			(target.querySelector('[data-testid="file-content-viewer"]') as HTMLElement).getAttribute(
				'data-lang'
			)
		).toBe('ts');
		unmount(instance);
	});

	it('an unknown lang renders the honest plain fallback', () => {
		const { target, instance } = mountView(
			view({ path: 'weird.xyz', lang: 'totally-unknown', lines: [line(1, 'raw bytes')], totalLines: 1 })
		);
		const plain = target.querySelector('[data-testid="file-viewer-plain"]');
		expect(plain).not.toBeNull();
		expect(plain?.textContent).toContain('raw bytes');
		unmount(instance);
	});

	it('no lang hint at all also renders the plain fallback', () => {
		const { target, instance } = mountView(
			view({ path: 'data.csv', lines: [line(1, 'a,b')], totalLines: 1 })
		);
		expect(target.querySelector('[data-testid="file-viewer-plain"]')).not.toBeNull();
		unmount(instance);
	});
});

describe('FileContentViewer — bounded render (RENDER_CAP)', () => {
	/** A window over the 400-line cap. */
	function overCapLines(count: number): DsiReadLine[] {
		return Array.from({ length: count }, (_, i) => line(i + 1));
	}

	it('a window over the cap grows the toggle; clicking flips expanded and back', () => {
		const { target, instance } = mountView(
			view({ path: 'big.log', lang: 'ts', lines: overCapLines(401), totalLines: 401 })
		);
		const toggle = target.querySelector('[data-testid="file-viewer-toggle"]') as HTMLButtonElement;
		expect(toggle).not.toBeNull();
		expect(toggle.textContent).toContain('show all 401 lines');
		// Expand…
		toggle.click();
		flushSync();
		const expandedToggle = target.querySelector(
			'[data-testid="file-viewer-toggle"]'
		) as HTMLButtonElement;
		expect(expandedToggle.textContent).toContain('show less');
		// …and collapse back.
		expandedToggle.click();
		flushSync();
		expect(
			(target.querySelector('[data-testid="file-viewer-toggle"]') as HTMLButtonElement).textContent
		).toContain('show all 401 lines');
		unmount(instance);
	});

	it('a window under the cap renders no toggle', () => {
		const { target, instance } = mountView(
			view({ path: 'small.log', lines: overCapLines(3), totalLines: 3 })
		);
		expect(target.querySelector('[data-testid="file-viewer-toggle"]')).toBeNull();
		unmount(instance);
	});
});
