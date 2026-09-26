/**
 * SessionFilterMeta unit tests — pins the contract of
 * SessionFilterMeta.svelte (the row's meta controls, extracted
 * 2026-09-04):
 *  - one container holding `All` (filter-all) + the three-segment
 *    count/workspace toggle;
 *  - `All` reports the FULL reset state through onchange —
 *    { workspace: null, preset: null, blankMode: 'any' };
 *  - a toggle segment reports the live filter with only blankMode
 *    changed;
 *  - the [folder] ghost rule: selecting the registered-only view while
 *    a GHOST workspace is selected lifts that selection in the SAME
 *    change; a registered workspace composes and stays.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionFilterMeta from '$lib/components/sessions/SessionFilterMeta.svelte';
import type { FilterOption, SessionFilterState } from '$lib/utils/session-filters';

const ALL_CLEAR: SessionFilterState = { workspace: null, preset: null, blankMode: 'any' };

const GHOST_WS: FilterOption = { key: '/tmp/ghost', label: 'ghost', count: 2, registered: false };
const REG_WS: FilterOption = {
	key: '/tmp/ws',
	label: 'ws',
	path: '/tmp/ws',
	count: 3,
	registered: true
};

function mountMeta(filter: SessionFilterState, workspaces: FilterOption[] = []) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onchange = vi.fn<(next: SessionFilterState) => void>();
	const instance = mount(SessionFilterMeta, { target, props: { workspaces, filter, onchange, oncreated: vi.fn() } });
	flushSync();
	return { target, instance, onchange };
}

const all = (target: HTMLElement): HTMLButtonElement =>
	target.querySelector('[data-testid="filter-all"]') as HTMLButtonElement;

const segment = (target: HTMLElement, name: 'empty' | 'nonempty' | 'workspace'): HTMLButtonElement =>
	target.querySelector(`[data-testid="filter-blank-${name}"]`) as HTMLButtonElement;

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SessionFilterMeta — composition', () => {
	it('holds `All` and the three toggle segments in one container', () => {
		const { target, instance } = mountMeta(ALL_CLEAR);
		expect(all(target)).not.toBeNull();
		expect(segment(target, 'empty')).not.toBeNull();
		expect(segment(target, 'nonempty')).not.toBeNull();
		expect(segment(target, 'workspace')).not.toBeNull();
		unmount(instance);
	});
});

describe('SessionFilterMeta — reporting', () => {
	it('`All` reports the full reset state', () => {
		const { target, instance, onchange } = mountMeta({
			workspace: '/tmp/ws',
			preset: 'coder',
			blankMode: 'nonempty'
		});
		all(target).click();
		flushSync();
		expect(onchange).toHaveBeenCalledWith({ workspace: null, preset: null, blankMode: 'any' });
		unmount(instance);
	});

	it('a toggle segment reports the live filter with only blankMode changed', () => {
		const { target, instance, onchange } = mountMeta({
			workspace: '/tmp/ws',
			preset: 'coder',
			blankMode: 'any'
		});
		segment(target, 'empty').click();
		flushSync();
		expect(onchange).toHaveBeenCalledWith({
			workspace: '/tmp/ws',
			preset: 'coder',
			blankMode: 'empty'
		});
		unmount(instance);
	});

	it('[folder] lifts a selected GHOST workspace in the same change', () => {
		const { target, instance, onchange } = mountMeta(
			{ workspace: '/tmp/ghost', preset: null, blankMode: 'any' },
			[GHOST_WS]
		);
		segment(target, 'workspace').click();
		flushSync();
		expect(onchange).toHaveBeenCalledWith({ workspace: null, preset: null, blankMode: 'workspace' });
		unmount(instance);
	});

	it('[folder] keeps a REGISTERED workspace selection (composes fine)', () => {
		const { target, instance, onchange } = mountMeta(
			{ workspace: '/tmp/ws', preset: null, blankMode: 'any' },
			[REG_WS]
		);
		segment(target, 'workspace').click();
		flushSync();
		expect(onchange).toHaveBeenCalledWith({ workspace: '/tmp/ws', preset: null, blankMode: 'workspace' });
		unmount(instance);
	});
});
