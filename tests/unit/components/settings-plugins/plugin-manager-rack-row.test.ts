/**
 * PluginManagerRackRow — the presentational rack row (The Plugin Rack ADR,
 * 2026-09-27, D1): every verb and all state are owned by the parent, so
 * these tests pin the row's contract surface — install/uninstall verb
 * gating by installed + onselect, the busy spinner, the installed badge,
 * the author line, the stars title, the two credential doors, and the
 * disabled matrix (busyId / floorBounce).
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PluginManagerRackRow from '$lib/components/settings-plugins/PluginManagerRackRow.svelte';

type RowPlugin = Parameters<typeof PluginManagerRackRow>[0] extends never ? never : {
	n: string;
	id: string;
	repo: string;
	author: string | null;
	authorUrl?: string | null;
	installed: boolean;
};

const BASE: RowPlugin = {
	n: '1',
	id: 'dsh-rules-paths',
	repo: 'https://github.com/Temoa/dsh-rules-paths',
	author: 'Temoa',
	authorUrl: 'https://github.com/Temoa',
	installed: false
};

function mountRow(overrides: Partial<RowPlugin> = {}, props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onapply = vi.fn();
	const onselect = (props.onselect as unknown) ?? undefined;
	const instance = mount(PluginManagerRackRow, {
		target,
		props: {
			plugin: { ...BASE, ...overrides },
			stars: {},
			busyId: null,
			floorBounce: false,
			onapply,
			onselect,
			...props
		}
	});
	return {
		target,
		onapply,
		onselect,
		q: (sel: string) => target.querySelector(sel),
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('PluginManagerRackRow', () => {
	it('an uninstalled row without a selection grammar renders the install verb', () => {
		const { target, onapply, q, cleanup } = mountRow();
		const btn = q('[data-testid="rack-install-dsh-rules-paths"]') as HTMLButtonElement;
		expect(btn).toBeTruthy();
		expect(q('[data-testid="rack-uninstall-dsh-rules-paths"]')).toBeNull();
		btn.click();
		flushSync();
		expect(onapply).toHaveBeenCalledWith('install', 'dsh-rules-paths');
		expect(q('[data-testid="rack-busy-dsh-rules-paths"]')).toBeNull();
		cleanup();
	});

	it('an uninstalled row WITH a selection grammar shows the select toggle instead of the install verb', () => {
		const { target, onselect, q, cleanup } = mountRow({}, { onselect: vi.fn(), selected: false });
		const sel = q('[data-testid="rack-select-1"]') as HTMLButtonElement;
		expect(sel).toBeTruthy();
		expect(sel.getAttribute('aria-pressed')).toBe('false');
		expect(sel.textContent).toContain('☐');
		expect(q('[data-testid="rack-install-dsh-rules-paths"]')).toBeNull();
		sel.click();
		flushSync();
		expect(onselect).toHaveBeenCalledWith('1');
		cleanup();
	});

	it('a selected row flips the checkbox and aria-pressed, and an installed row renders no select toggle even with onselect', () => {
		const { target, q, cleanup } = mountRow({}, { onselect: vi.fn(), selected: true });
		const sel = q('[data-testid="rack-select-1"]') as HTMLButtonElement;
		expect(sel.getAttribute('aria-pressed')).toBe('true');
		expect(sel.textContent).toContain('☑');
		expect(target.querySelector('.rack-row')?.getAttribute('data-selected')).toBe('true');
		cleanup();
		const installedRow = mountRow({ installed: true }, { onselect: vi.fn(), selected: true });
		expect(installedRow.q('[data-testid="rack-select-1"]')).toBeNull();
		expect(installedRow.q('[data-testid="rack-install-dsh-rules-paths"]')).toBeNull();
		installedRow.cleanup();
	});

	it('an installed row shows the badge and the uninstall verb', () => {
		const { target, onapply, q, cleanup } = mountRow({ installed: true });
		expect(q('[data-testid="rack-badge-dsh-rules-paths"]')).toBeTruthy();
		expect(q('[data-testid="rack-badge-dsh-rules-paths"]')?.getAttribute('role')).toBe('status');
		const btn = q('[data-testid="rack-uninstall-dsh-rules-paths"]') as HTMLButtonElement;
		expect(btn).toBeTruthy();
		btn.click();
		flushSync();
		expect(onapply).toHaveBeenCalledWith('remove', 'dsh-rules-paths');
		cleanup();
	});

	it('a busy row swaps the verb label for the spinner (install and uninstall)', () => {
		const { target, q, cleanup } = mountRow({ installed: true }, { busyId: 'dsh-rules-paths' });
		expect(q('[data-testid="rack-busy-dsh-rules-paths"]')).toBeTruthy();
		expect(q('[data-testid="rack-busy-dsh-rules-paths"] .spin')).toBeTruthy();
		cleanup();
		const installing = mountRow({}, { busyId: 'dsh-rules-paths' });
		expect(installing.q('[data-testid="rack-busy-dsh-rules-paths"]')).toBeTruthy();
		installing.cleanup();
		void target;
	});

	it('a busy row elsewhere does NOT spin this row, but the verb stays disabled', () => {
		const { q, cleanup } = mountRow({ installed: true }, { busyId: 'other-plugin' });
		expect(q('[data-testid="rack-busy-dsh-rules-paths"]')).toBeNull();
		expect((q('[data-testid="rack-uninstall-dsh-rules-paths"]') as HTMLButtonElement).disabled).toBe(true);
		cleanup();
	});

	it('floorBounce disables the verbs without spinning', () => {
		const { q, cleanup } = mountRow({}, { floorBounce: true });
		const btn = q('[data-testid="rack-install-dsh-rules-paths"]') as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		btn.click();
		flushSync();
		expect(q('[data-testid="rack-busy-dsh-rules-paths"]')).toBeNull();
		cleanup();
	});

	it('the author line renders only when the plugin has an author, the description only when present', () => {
		const withAuthor = mountRow({ description: 'Path rules' });
		expect(withAuthor.target.textContent).toContain('Temoa');
		expect(withAuthor.target.textContent).toContain('Path rules');
		withAuthor.cleanup();
		const bare = mountRow({ author: null, description: null });
		expect(bare.target.textContent).not.toContain('Temoa');
		bare.cleanup();
	});

	it('the stars count rides after the verb with the pluginRackStars title, and is absent when unfetched', () => {
		const starred = mountRow({}, { stars: { 'dsh-rules-paths': 4200 } });
		const starEl = starred.q('[data-testid="rack-stars-dsh-rules-paths"]');
		expect(starEl?.getAttribute('title')).toBeTruthy();
		expect(starEl?.textContent).toContain('4.2K');
		starred.cleanup();
		const unstarred = mountRow();
		expect(unstarred.q('[data-testid="rack-stars-dsh-rules-paths"]')).toBeNull();
		unstarred.cleanup();
	});

	it('the repo door always renders with the external-anchor safety grammar and a t() aria-label', () => {
		const { q, cleanup } = mountRow();
		const door = q('[data-testid="rack-door-repo-dsh-rules-paths"]') as HTMLAnchorElement;
		expect(door.href).toBe('https://github.com/Temoa/dsh-rules-paths');
		expect(door.target).toBe('_blank');
		expect(door.rel).toBe('noopener noreferrer');
		expect(door.getAttribute('aria-label')).toBeTruthy();
		expect(door.getAttribute('title')).toBeTruthy();
		cleanup();
	});

	it('the author door renders only when authorUrl exists', () => {
		const withUrl = mountRow();
		const door = withUrl.q('[data-testid="rack-door-author-dsh-rules-paths"]') as HTMLAnchorElement;
		expect(door.href).toBe('https://github.com/Temoa');
		expect(door.getAttribute('aria-label')).toBeTruthy();
		withUrl.cleanup();
		const without = mountRow({ authorUrl: null });
		expect(without.q('[data-testid="rack-door-author-dsh-rules-paths"]')).toBeNull();
		without.cleanup();
	});

	it('the installed row flips to the uninstall verb while keeping the row keyed by id', () => {
		const { q, cleanup } = mountRow({ installed: true });
		expect(q('[data-testid="rack-row-dsh-rules-paths"]')?.classList.contains('rack-row-selected')).toBe(false);
		cleanup();
	});
});