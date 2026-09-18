/**
 * MarkdownPanel host tests (Loadinjected W4 4.1-T) — the .md member's
 * read surface (ADR D1): a thin wrapper over the transcript's own
 * MarkdownContent renderer (REUSED unchanged), fed the LOGGED payload.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import MarkdownPanel from '$lib/components/panels/MarkdownPanel.svelte';

function mountPanel(content: string) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(MarkdownPanel, { target, props: { content } });
	flushSync();
	return {
		target,
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

describe('MarkdownPanel (Loadinjected W4 4.1-T)', () => {
	it('renders markdown content through the shared renderer', () => {
		const h = mountPanel('# The Rules\n\nbody text');
		const panel = h.target.querySelector('[data-testid="markdown-panel"]');
		expect(panel).not.toBeNull();
		expect(panel!.innerHTML).toContain('<h1>');
		expect(panel!.innerHTML).toContain('The Rules');
		h.cleanup();
	});

	it('plain text stays a lean .md-content mount (no invented chrome)', () => {
		const h = mountPanel('plain operator note');
		const panel = h.target.querySelector('[data-testid="markdown-panel"]');
		expect(panel!.innerHTML).toContain('plain operator note');
		expect(panel!.innerHTML).not.toContain('<h1>');
		h.cleanup();
	});
});
