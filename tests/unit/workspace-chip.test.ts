/**
 * WorkspaceChip unit tests — the single workspace chip identity.
 *
 * happy-dom mount; covers the registered vs ghost identity classes, the
 * trailing/children snippet seats, and the host-overridable testid/title/
 * class/spread props.
 */
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import WorkspaceChip from '$lib/components/common/WorkspaceChip.svelte';

const targets: HTMLElement[] = [];

function render(props: Record<string, unknown>): HTMLElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	targets.push(target);
	mount(WorkspaceChip, { target, props: props as never });
	flushSync();
	return target;
}

afterEach(() => {
	for (const target of targets) unmount(target);
	targets.length = 0;
});

describe('WorkspaceChip', () => {
	it('renders the label with the registered (non-ghost) identity', () => {
		const el = render({ label: 'proj' });
		const chip = el.querySelector('span.ws-chip')!;
		expect(chip.textContent).toContain('proj');
		expect(chip.classList.contains('ghost')).toBe(false);
		expect(chip.querySelector('.chip-label')?.textContent).toBe('proj');
		expect(chip.querySelector('svg')).toBeTruthy();
	});

	it('applies the ghost identity class', () => {
		const el = render({ label: 'gone', ghost: true });
		expect(el.querySelector('span.ws-chip')!.classList.contains('ghost')).toBe(true);
	});

	it('pins testid, title, and extra class on the root', () => {
		const el = render({ label: 'x', testid: 'chip-x', title: '/tmp/x', class: 'menuable' });
		const chip = el.querySelector('span.ws-chip') as HTMLElement;
		expect(chip.dataset['testid']).toBe('chip-x');
		expect(chip.getAttribute('title')).toBe('/tmp/x');
		expect(chip.classList.contains('menuable')).toBe(true);
	});

	it('respects the iconSize prop on the folder glyph', () => {
		const el = render({ label: 'x', iconSize: 14 });
		const svg = el.querySelector('svg')!;
		expect(svg.getAttribute('width')).toBe('14');
	});

	it('renders the trailing snippet seat', () => {
		const trailing = createRawSnippet(() => ({ render: () => '<b class="count">3</b>', setup: () => {} }));
		const el = render({ label: 'x', trailing });
		expect(el.querySelector('b.count')?.textContent).toBe('3');
	});

	it('renders the children snippet seat', () => {
		const children = createRawSnippet(() => ({ render: () => '<i class="seat">y</i>', setup: () => {} }));
		const el = render({ label: 'x', children });
		expect(el.querySelector('i.seat')?.textContent).toBe('y');
	});

	it('spreads rest props onto the root span', () => {
		const el = render({ label: 'x', role: 'button', 'data-extra': '1' });
		const chip = el.querySelector('span.ws-chip') as HTMLElement;
		expect(chip.getAttribute('role')).toBe('button');
		expect(chip.dataset['extra']).toBe('1');
	});
});
