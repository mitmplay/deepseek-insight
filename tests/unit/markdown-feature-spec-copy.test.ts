/**
 * MarkdownContent feature-spec canvas copy (2026-09-05): a rendered
 * bold "feature-spec:" lead flags the whole block for a top-right
 * CanvasCopyButton — in the full path inside the hover action row, and in
 * the lean path (hideToggle, no wrapper) through a DOM attach that makes
 * the container its own positioning anchor.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';

// happy-dom has no canvas — stub the pair CanvasCopyButton imports.
vi.mock('html-to-image', () => ({ toBlob: vi.fn(), toCanvas: vi.fn() }));

const SPEC = '**feature-spec: PRD + tasks pipeline**\n\nOne trigger produces the full spec.';
const PLAIN = 'just **bold** prose, no spec lead';

function mountContent(props: { content: string; small?: boolean; hideToggle?: boolean }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(MarkdownContent, { target, props });
	flushSync();
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

const buttons = (t: HTMLElement) => t.querySelectorAll('[data-testid="canvas-copy-button"]');

afterEach(() => {
	document.body.innerHTML = '';
});

describe('MarkdownContent — feature-spec canvas copy', () => {
	it('full path: a bold feature-spec lead adds the top-right capture button', () => {
		const h = mountContent({ content: SPEC });
		const btn = h.target.querySelector('[data-testid="canvas-copy-button"]') as HTMLButtonElement;
		expect(btn).not.toBeNull();
		const row = btn.closest('div') as HTMLElement;
		expect(row.className.includes('absolute')).toBe(true);
		expect(row.className.includes('right-1.5')).toBe(true);
		expect(row.className.includes('group-hover/markdown:opacity-100')).toBe(true);
		expect(btn.title).toBe('Copy feature spec as image (Shift+Click to save)');
		// The markdown Copy/Raw pair still rides the same row
		expect(row.querySelector('[data-testid="raw-toggle-button"]')).not.toBeNull();
		h.cleanup();
	});

	it('full path: no spec lead, no spec button', () => {
		const h = mountContent({ content: PLAIN });
		expect(buttons(h.target)).toHaveLength(0);
		h.cleanup();
	});

	it('lean path (hideToggle): the button anchors to the md-content itself', () => {
		const h = mountContent({ content: SPEC, hideToggle: true });
		const md = h.target.querySelector('.md-content') as HTMLElement;
		expect(md.classList.contains('relative')).toBe(true);
		expect(md.classList.contains('group/featurespec')).toBe(true);
		const host = md.querySelector('[data-testid="canvas-copy-button"]')?.closest('div') as HTMLElement;
		expect(host).not.toBeNull();
		expect(host.className.includes('right-1.5')).toBe(true);
		expect(host.className.includes('group-hover/featurespec:opacity-100')).toBe(true);
		expect(host.parentElement).toBe(md);
		expect(host.querySelector('[data-testid="canvas-copy-button"]')).not.toBeNull();
		// The spec text rendered through the allow-list as a strong lead
		expect(md.querySelector('strong')?.textContent).toContain('feature-spec: PRD');
		h.cleanup();
	});

	it('lean path: no spec lead, the container stays bare', () => {
		const h = mountContent({ content: PLAIN, hideToggle: true });
		const md = h.target.querySelector('.md-content') as HTMLElement;
		expect(md.classList.contains('relative')).toBe(false);
		expect(buttons(h.target)).toHaveLength(0);
		h.cleanup();
	});
});
