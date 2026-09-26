/**
 * PanelColumn unit tests — the width badge's phase prop (the branch
 * cluster no existing test reaches: every prior mount omits widthBadge).
 *
 * The route owns the badge lifecycle and passes the phase down:
 *  - 'live'    → badge visible at the column's top right, no fade class
 *  - 'fading'  → same badge through its 10s afterglow, fade class on
 *  - omitted   → no badge at all (the default null)
 *  - the badge text is the ROUNDED width (fractional drags show whole px)
 */

import { flushSync, createRawSnippet } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PanelColumn from '$lib/components/panels/PanelColumn.svelte';
import type { DsiPanelEntry } from '$lib/types';

function bodySnippet() {
	return createRawSnippet(() => ({ render: () => '<div>panel body</div>' }));
}

function entry(id: string, sessionId: string, width: number): DsiPanelEntry {
	return { id, kind: 'conversation', sessionId, agentPreset: null, width };
}

function mountColumn(props: { panel?: DsiPanelEntry; widthBadge?: 'live' | 'fading' }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PanelColumn, {
		target,
		props: {
			panel: props.panel ?? entry('p1', 's-1', 730),
			index: 0,
			selected: false,
			widthBadge: props.widthBadge ?? null,
			onremove: vi.fn(),
			children: bodySnippet()
		}
	});
	flushSync();
	return { target, instance };
}

const badge = (target: HTMLElement): HTMLElement | null =>
	target.querySelector('[data-testid="panel-width-badge"]');

afterEach(() => {
	document.body.innerHTML = '';
});

describe('PanelColumn — width badge phases (route-owned lifecycle)', () => {
	it('live phase floats the current width with no fade class', () => {
		const { target, instance } = mountColumn({ widthBadge: 'live' });
		const el = badge(target);
		expect(el).not.toBeNull();
		expect(el?.getAttribute('data-badge-phase')).toBe('live');
		expect(el?.classList.contains('fading')).toBe(false);
		expect(el?.getAttribute('aria-hidden')).toBe('true');
		unmount(instance);
	});

	it('fading phase keeps the badge visible and carries the fade class', () => {
		const { target, instance } = mountColumn({ widthBadge: 'fading' });
		const el = badge(target);
		expect(el).not.toBeNull();
		expect(el?.getAttribute('data-badge-phase')).toBe('fading');
		expect(el?.classList.contains('fading')).toBe(true);
		unmount(instance);
	});

	it('no phase prop renders no badge (the default null)', () => {
		const { target, instance } = mountColumn({});
		expect(badge(target)).toBeNull();
		unmount(instance);
	});

	it('the badge text is the width rounded to whole px (fractional drag)', () => {
		const { target, instance } = mountColumn({
			panel: entry('p2', 's-2', 729.6),
			widthBadge: 'live'
		});
		expect(badge(target)?.textContent).toBe('730px');
		unmount(instance);
	});
});
