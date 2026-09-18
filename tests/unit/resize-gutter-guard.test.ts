/**
 * ResizeGutter unit tests — the gutter's index-less render path (the
 * compiled `panel-gutter-${index ?? ''}` guard; every route mount passes
 * a numeric index, so panels-row.test.ts only pins the indexed side).
 *
 * Pins that a gutter without an index:
 *  - still renders a button under the bare `panel-gutter-` testid
 *  - still reports mousedown through the registry, carrying the absent
 *    index as undefined
 *  - preventDefaults the mousedown (a drag start never selects text)
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ResizeGutter from '$lib/components/panels/ResizeGutter.svelte';
import {
	registerStartPanelResize,
	resetPanelRegistryForTests
} from '$lib/services/panels/panel-registry';

/**
 * Mount with or without the required index — the undefined case crosses
 * the component's TS contract on purpose, to pin the compiled nullish
 * guard's render (documented cast at the boundary).
 */
function mountGutter(index?: number) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const props = (index === undefined ? {} : { index }) as { index: number };
	const instance = mount(ResizeGutter, { target, props });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
	resetPanelRegistryForTests();
});

describe('ResizeGutter — gutter without an index', () => {
	it('renders under the bare panel-gutter- testid as a resize button', () => {
		const { target, instance } = mountGutter();
		const el = target.querySelector('[data-testid="panel-gutter-"]') as HTMLElement;
		expect(el).not.toBeNull();
		expect(el.tagName).toBe('BUTTON');
		expect(el.getAttribute('type')).toBe('button');
		expect(el.getAttribute('aria-label')).toBe('Resize panel');
		unmount(instance);
	});

	it('mousedown still reports through the registry with the absent index', async () => {
		const seen: Array<{ event: MouseEvent; index: number | undefined }> = [];
		registerStartPanelResize((event, index) => seen.push({ event, index }));
		const { target, instance } = mountGutter();
		const el = target.querySelector('[data-testid="panel-gutter-"]') as HTMLElement;
		el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		// The gutter's registry import is dynamic — real microtask turns.
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		expect(seen).toHaveLength(1);
		expect(seen[0].index).toBeUndefined();
		// The same event was preventDefault-ed before the report.
		expect(seen[0].event.defaultPrevented).toBe(true);
		unmount(instance);
	});

	it('an unregistered floor keeps the index-less drag a graceful no-op', async () => {
		const { target, instance } = mountGutter();
		const el = target.querySelector('[data-testid="panel-gutter-"]') as HTMLElement;
		expect(() =>
			el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
		).not.toThrow();
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		unmount(instance);
	});

	it('a registered numeric index still renders its own testid (the sibling contract)', () => {
		const { target, instance } = mountGutter(3);
		expect(target.querySelector('[data-testid="panel-gutter-3"]')).not.toBeNull();
		unmount(instance);
	});

	// ── The Explorer Layout (ADR 2026-09-17 D4, Task 2.2-T): the optional
	//    onDragStart owner prop — fires INSTEAD of the registry. ──

	it('onDragStart receives the mousedown and the registry is never touched', async () => {
		const seen: MouseEvent[] = [];
		registerStartPanelResize(() => {
			throw new Error('registry must not fire when a local owner is given');
		});
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(ResizeGutter, {
			target,
			props: { index: 0, onDragStart: (e: MouseEvent) => seen.push(e) }
		});
		flushSync();
		const el = target.querySelector('[data-testid="panel-gutter-0"]') as HTMLElement;
		el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		// The registry import is dynamic — give a would-be promise the same
		// microtask turns the floor path gets; the throw above would surface.
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		expect(seen).toHaveLength(1);
		expect(seen[0].defaultPrevented).toBe(true);
		unmount(instance);
	});

	it('the floor path stays verbatim when the prop is absent (pinned)', async () => {
		const seen: Array<{ event: MouseEvent; index: number }> = [];
		registerStartPanelResize((event, index) => seen.push({ event, index }));
		const { target, instance } = mountGutter(2);
		const el = target.querySelector('[data-testid="panel-gutter-2"]') as HTMLElement;
		el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		expect(seen).toHaveLength(1);
		expect(seen[0].index).toBe(2);
		unmount(instance);
	});
});
