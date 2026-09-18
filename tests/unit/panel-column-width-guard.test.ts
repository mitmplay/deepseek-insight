/**
 * PanelColumn unit tests — the inline width style's nullish guard (the
 * compiled `panel.width ?? ''` fallbacks in the triple-lock template;
 * the typed DsiPanelEntry requires a numeric width, so no route or
 * harness mount can reach the guard's fallback side).
 *
 * A nullish width crossing the prop boundary degrades safely:
 *  - the column still renders with its identity attributes
 *  - the invalid `width: px` declaration is dropped — no inline width
 *    lock, never a crash
 */

import { flushSync, createRawSnippet } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PanelColumn from '$lib/components/panels/PanelColumn.svelte';
import type { DsiPanelEntry } from '$lib/types';

function bodySnippet() {
	return createRawSnippet(() => ({ render: () => '<div>panel body</div>' }));
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('PanelColumn — nullish width degrades to no inline lock', () => {
	it('a null width renders the column shell without a px style lock', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const panel = {
			id: 'p1',
		kind: 'conversation',
			sessionId: 's-1',
			agentPreset: null,
			width: null as unknown as number
		} as DsiPanelEntry;
		const instance = mount(PanelColumn, {
			target,
			props: {
				panel,
				index: 0,
				selected: false,
				onremove: vi.fn(),
				children: bodySnippet()
			}
		});
		flushSync();
		const column = target.querySelector('[data-testid="panel-column"]') as HTMLElement;
		expect(column).not.toBeNull();
		expect(column.getAttribute('data-panel-id')).toBe('p1');
		expect(column.getAttribute('data-session-id')).toBe('s-1');
		// The invalid `width: px` declarations never land in the style map.
		expect(column.style.width).toBe('');
		// The gutter sibling still renders after the column.
		expect(target.querySelector('[data-testid="panel-gutter-0"]')).not.toBeNull();
		unmount(instance);
	});
});
