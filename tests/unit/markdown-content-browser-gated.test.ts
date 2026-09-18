/**
 * MarkdownContent browser-gate tests — the mermaid render pass is gated on
 * `$app/environment`'s `browser` flag (lazy runtime must never load on the
 * server). This file mounts with the REAL stub (browser: false — no
 * $app/environment mock here, unlike every other MarkdownContent test):
 * a ```mermaid document still renders its placeholder, but the runtime is
 * never imported, never initialized, and the placeholder stays unprocessed.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';

const mermaidRender = vi.fn(async (_id: string, _source: string) => ({ svg: '<svg></svg>' }));
const mermaidInitialize = vi.fn();

vi.mock('mermaid', () => ({
	default: {
		initialize: (...args: unknown[]) => mermaidInitialize(...args),
		render: (...args: unknown[]) => mermaidRender(...(args as [string, string]))
	}
}));

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		await Promise.resolve();
	}
	flushSync();
}

describe('MarkdownContent — server-side render gate', () => {
	it('a mermaid document keeps its placeholder unprocessed; the runtime never loads', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(MarkdownContent, {
			target,
			props: { content: 'before\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nafter' }
		});
		await settle();
		const diagram = target.querySelector('.mermaid-diagram');
		expect(diagram).not.toBeNull(); // the placeholder renders…
		expect(diagram?.getAttribute('data-processed')).toBe('false'); // …but stays raw
		expect(mermaidInitialize).not.toHaveBeenCalled();
		expect(mermaidRender).not.toHaveBeenCalled();
		unmount(comp);
	});
});
