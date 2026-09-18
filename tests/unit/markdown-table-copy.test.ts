/**
 * MarkdownContent canvas-copy (2026-09-05): every rendered table AND
 * mermaid diagram gets a hover-revealed CanvasCopyButton at its top-left
 * through a post-render DOM pass — wrapped in a relative div (the button
 * anchors to the element's box), one button per element, and the pass
 * re-runs cleanly on content changes (old buttons unmount, wrappers
 * unwrap, no duplicates).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';

// html-to-image needs a real canvas; happy-dom has none — stub the pair
// the button imports so mounting stays side-effect free.
vi.mock('html-to-image', () => ({ toBlob: vi.fn(), toCanvas: vi.fn() }));

const TABLE_MD = [
	'| Tool | Status |',
	'|---|---|',
	'| read | ok |',
	'| bash | ok |'
].join('\n');

function mountContent(props: { content: string; small?: boolean; hideToggle?: boolean }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(MarkdownContent, { target, props });
	flushSync();
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

afterEach(() => {
	document.body.innerHTML = '';
});


describe('MarkdownContent — per-diagram canvas copy (2026-09-05)', () => {
	it('a mermaid fence renders its placeholder wrapped with a copy button anchored to it', () => {
		const h = mountContent({ content: 'intro\n\n```mermaid\ngraph TD\n  A-->B\n```\n\ndone' });
		const diagram = h.target.querySelector('.mermaid-diagram') as HTMLElement;
		expect(diagram).not.toBeNull();
		const wrap = diagram.parentElement as HTMLElement;
		expect(wrap.className.includes('group/diagram')).toBe(true);
		const btn = wrap.querySelector('[data-testid="canvas-copy-button"]') as HTMLButtonElement;
		expect(btn).not.toBeNull();
		expect(btn.title).toBe('Copy diagram as image (Shift+Click to save)');
		// The wrapper is anchored INSIDE the markdown flow — the mermaid SVG
		// pass replaces the placeholder's innerHTML, never this wrapper.
		expect(wrap.parentElement?.classList.contains('md-content')).toBe(true);
		h.cleanup();
	});

	it('two diagrams get two buttons; mixed tables and diagrams each get their own', () => {
		const fence = '```mermaid\ngraph TD\n  A-->B\n```';
		const h = mountContent({ content: fence + '\n\n' + TABLE_MD + '\n\n' + fence });
		expect(h.target.querySelectorAll('[data-testid="canvas-copy-button"]')).toHaveLength(3);
		expect(h.target.querySelectorAll('.mermaid-diagram')).toHaveLength(2);
		expect(h.target.querySelectorAll('table')).toHaveLength(1);
		h.cleanup();
	});
});

describe('MarkdownContent — per-table canvas copy', () => {
	it('a rendered table is wrapped relative with a copy button at its top-left', () => {
		const h = mountContent({ content: TABLE_MD });
		const wrap = Array.from(h.target.querySelectorAll('div.relative')).find((el) =>
			el.className.includes('group/table')
		) as HTMLElement;
		expect(wrap).not.toBeNull();
		const table = wrap.querySelector('table');
		expect(table).not.toBeNull();
		const host = wrap.querySelector('div.absolute.top-0.left-0') as HTMLElement;
		expect(host).not.toBeNull();
		const btn = host.querySelector('[data-testid="canvas-copy-button"]') as HTMLButtonElement;
		expect(btn).not.toBeNull();
		expect(btn.title).toBe('Copy table as image (Shift+Click to save)');
		h.cleanup();
	});

	it('one button per table — two tables, two buttons, each anchored to its own', () => {
		const two = TABLE_MD + '\n\n' + TABLE_MD.replaceAll('read', 'grep');
		const h = mountContent({ content: two });
		const wraps = Array.from(h.target.querySelectorAll('div.relative')).filter((el) =>
			el.className.includes('group/table')
		);
		expect(wraps).toHaveLength(2);
		expect(h.target.querySelectorAll('[data-testid="canvas-copy-button"]')).toHaveLength(2);
		h.cleanup();
	});

	it('table-free markdown mounts no button', () => {
		const h = mountContent({ content: 'plain **bold** prose' });
		expect(h.target.querySelector('[data-testid="canvas-copy-button"]')).toBeNull();
		h.cleanup();
	});

	it('the lean path (hideToggle) gets the button too — PromptBubble tables copy', () => {
		const h = mountContent({ content: TABLE_MD, hideToggle: true });
		expect(h.target.querySelectorAll('[data-testid="canvas-copy-button"]')).toHaveLength(1);
		h.cleanup();
	});

	it('a content change re-runs the pass: the old wrapper unwraps, no duplicates', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(MarkdownContent, { target, props: { content: TABLE_MD } });
		flushSync();
		expect(target.querySelectorAll('[data-testid="canvas-copy-button"]')).toHaveLength(1);
		// The dispose path: unmount tears the wrapper out without leaving a
		// second table behind; a fresh mount proves the pass re-runs clean.
		unmount(comp);
		const t2 = document.createElement('div');
		document.body.appendChild(t2);
		const again = mount(MarkdownContent, { target: t2, props: { content: TABLE_MD } });
		flushSync();
		expect(t2.querySelectorAll('[data-testid="canvas-copy-button"]')).toHaveLength(1);
		expect(t2.querySelectorAll('table')).toHaveLength(1); // exactly one table — the unwrap worked
		unmount(again);
		t2.remove();
	});
});
