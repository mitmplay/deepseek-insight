/**
 * ReasoningContentViewer (2026-09-05): the reasoning body's two sizes
 * (small vs default) and the copy-value contract — the raw markdown
 * source, not the rendered HTML.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ReasoningContentViewer from '$lib/components/common/viewers/ReasoningContentViewer.svelte';

function mountViewer(content: string, small = false) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(ReasoningContentViewer, { target, props: { content, small } });
	flushSync();
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ReasoningContentViewer', () => {
	it('renders sanitized markdown and carries the copy pair over the body', () => {
		const h = mountViewer('# The plan\n- step one');
		const body = h.target.querySelector('[data-testid="reasoning-body"]') as HTMLElement;
		expect(body.className).toContain('text-[12px]');
		expect(body.querySelector('h1')?.textContent).toBe('The plan');
		expect(h.target.querySelector('[data-testid="reasoning-actions"]')).not.toBeNull();
		h.cleanup();
	});

	it('small={true} wears the tighter text size', () => {
		const h = mountViewer('brief', true);
		const body = h.target.querySelector('[data-testid="reasoning-body"]') as HTMLElement;
		expect(body.className).toContain('text-xs');
		expect(body.className).not.toContain('text-[12px]');
		h.cleanup();
	});
});
