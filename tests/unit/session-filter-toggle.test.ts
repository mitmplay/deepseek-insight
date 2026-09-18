/**
 * SessionFilterToggle unit tests — the quad-state [0] | [!0] | [folder]
 * segmented pill:
 *  - 'any': no segment selected; tapping a segment reports that mode
 *  - tapping the SELECTED segment unselects it (reports 'any')
 *  - segments are mutually exclusive: the active mode marks exactly one
 *    segment (aria-pressed + on state)
 *  - the group is announced as one control (role=group + aria-label)
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionFilterToggle from '$lib/components/sessions/SessionFilterToggle.svelte';
import type { BlankMode } from '$lib/utils/session-filters';

type Mode = BlankMode;

function mountFilter(mode: Mode) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onchange = vi.fn<(next: Mode) => void>();
	const comp = mount(SessionFilterToggle, { target, props: { mode, onchange } });
	flushSync();
	return { target, onchange, comp };
}

const segment = (target: HTMLElement, name: 'empty' | 'nonempty' | 'workspace'): HTMLButtonElement =>
	target.querySelector(`[data-testid="filter-blank-${name}"]`) as HTMLButtonElement;

const click = (target: HTMLElement, name: 'empty' | 'nonempty' | 'workspace'): void => {
	segment(target, name).click();
	flushSync();
};

const pressed = (target: HTMLElement, name: 'empty' | 'nonempty' | 'workspace'): string | null =>
	segment(target, name).getAttribute('aria-pressed');

const on = (target: HTMLElement, name: 'empty' | 'nonempty' | 'workspace'): boolean =>
	segment(target, name).classList.contains('on');

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SessionFilterToggle — group chrome', () => {
	it('renders one announced group with the three segments', () => {
		const { target, comp } = mountFilter('any');
		const group = target.querySelector('[data-testid="filter-blank-toggle"]') as HTMLElement;
		expect(group.getAttribute('role')).toBe('group');
		expect(group.getAttribute('aria-label')).toBe('Filter by conversation count or workspace');
		expect(segment(target, 'empty').textContent).toContain('0');
		expect(segment(target, 'nonempty').textContent).toContain('#');
		expect(segment(target, 'workspace').querySelector('svg')).not.toBeNull();
		unmount(comp);
	});
});

describe('SessionFilterToggle — "any" mode', () => {
	it('no segment is pressed or marked on', () => {
		const { target, comp } = mountFilter('any');
		expect(pressed(target, 'empty')).toBe('false');
		expect(pressed(target, 'nonempty')).toBe('false');
		expect(pressed(target, 'workspace')).toBe('false');
		expect(on(target, 'empty')).toBe(false);
		expect(on(target, 'nonempty')).toBe(false);
		expect(on(target, 'workspace')).toBe(false);
		unmount(comp);
	});

	it('each tap selects that segment: empty, nonempty, workspace are reported as-is', () => {
		const a = mountFilter('any');
		click(a.target, 'empty');
		expect(a.onchange).toHaveBeenCalledWith('empty');
		const b = mountFilter('any');
		click(b.target, 'nonempty');
		expect(b.onchange).toHaveBeenCalledWith('nonempty');
		const c = mountFilter('any');
		click(c.target, 'workspace');
		expect(c.onchange).toHaveBeenCalledWith('workspace');
		unmount(a.comp);
		unmount(b.comp);
		unmount(c.comp);
	});
});

describe('SessionFilterToggle — selecting a segment marks only it', () => {
	it("'empty' presses exactly the [0] segment", () => {
		const { target, comp } = mountFilter('empty');
		expect(pressed(target, 'empty')).toBe('true');
		expect(on(target, 'empty')).toBe(true);
		expect(pressed(target, 'nonempty')).toBe('false');
		expect(pressed(target, 'workspace')).toBe('false');
		unmount(comp);
	});

	it("'nonempty' presses exactly the [!0] segment", () => {
		const { target, comp } = mountFilter('nonempty');
		expect(pressed(target, 'nonempty')).toBe('true');
		expect(on(target, 'nonempty')).toBe(true);
		expect(pressed(target, 'empty')).toBe('false');
		expect(pressed(target, 'workspace')).toBe('false');
		unmount(comp);
	});

	it("'workspace' presses exactly the [folder] segment", () => {
		const { target, comp } = mountFilter('workspace');
		expect(pressed(target, 'workspace')).toBe('true');
		expect(on(target, 'workspace')).toBe(true);
		expect(pressed(target, 'empty')).toBe('false');
		expect(pressed(target, 'nonempty')).toBe('false');
		unmount(comp);
	});
});

describe('SessionFilterToggle — unselect and re-select semantics', () => {
	it('tapping the selected segment unselects it (reports "any")', () => {
		const a = mountFilter('empty');
		click(a.target, 'empty');
		expect(a.onchange).toHaveBeenCalledWith('any');
		const b = mountFilter('nonempty');
		click(b.target, 'nonempty');
		expect(b.onchange).toHaveBeenCalledWith('any');
		const c = mountFilter('workspace');
		click(c.target, 'workspace');
		expect(c.onchange).toHaveBeenCalledWith('any');
		unmount(a.comp);
		unmount(b.comp);
		unmount(c.comp);
	});

	it('switching from the selected segment to a sibling reports the new mode', () => {
		const a = mountFilter('empty');
		click(a.target, 'nonempty');
		expect(a.onchange).toHaveBeenCalledWith('nonempty');
		const b = mountFilter('workspace');
		click(b.target, 'nonempty');
		expect(b.onchange).toHaveBeenCalledWith('nonempty');
		unmount(a.comp);
		unmount(b.comp);
	});
});
