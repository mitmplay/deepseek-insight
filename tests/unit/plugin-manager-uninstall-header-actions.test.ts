/**
 * Direct-mount tests for the two extracted rack chrome components:
 * PluginManagerUninstall (the per-row uninstall verb) and
 * PluginManagerHeaderActions (reload verb + collapse/expand fold pill).
 * Presentational seams only — every verb is a prop callback from
 * PluginManagerPanel, so the story is about which arms render.
 */
import { flushSync, mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PluginManagerUninstall from '../../src/lib/components/settings-plugins/PluginManagerUninstall.svelte';
import PluginManagerHeaderActions from '../../src/lib/components/settings-plugins/PluginManagerHeaderActions.svelte';

function mountComponent<C>(Comp: C, props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(Comp as never, { target, props });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('PluginManagerUninstall', () => {
	it('an installed row renders the uninstall verb and fires onremove with the plugin id', async () => {
		const onremove = vi.fn();
		const { target } = mountComponent(PluginManagerUninstall, {
			plugin: { id: 'dsh-rules-paths', installed: true },
			busyId: null,
			floorBounce: false,
			onremove
		});
		const btn = target.querySelector('[data-testid="rack-uninstall-dsh-rules-paths"]') as HTMLButtonElement;
		expect(btn).toBeTruthy();
		// idle: no busy spinner, plain verb label
		expect(target.querySelector('[data-testid="rack-busy-dsh-rules-paths"]')).toBeNull();
		expect(btn.disabled).toBe(false);
		btn.click();
		flushSync();
		expect(onremove).toHaveBeenCalledWith('dsh-rules-paths');
	});

	it('its own row busy (busyId === plugin.id) shows the busy spinner and disables the verb', async () => {
		const onremove = vi.fn();
		const { target } = mountComponent(PluginManagerUninstall, {
			plugin: { id: 'dsh-rules-paths', installed: true },
			busyId: 'dsh-rules-paths',
			floorBounce: false,
			onremove
		});
		const btn = target.querySelector('[data-testid="rack-uninstall-dsh-rules-paths"]') as HTMLButtonElement;
		expect(target.querySelector('[data-testid="rack-busy-dsh-rules-paths"]')).toBeTruthy();
		expect(btn.disabled).toBe(true); // busyId !== null arm
	});

	it('another row busy (busyId differs) keeps the verb idle-looking but disabled', async () => {
		const onremove = vi.fn();
		const { target } = mountComponent(PluginManagerUninstall, {
			plugin: { id: 'a', installed: true },
			busyId: 'b',
			floorBounce: false,
			onremove
		});
		const btn = target.querySelector('[data-testid="rack-uninstall-a"]') as HTMLButtonElement;
		expect(target.querySelector('[data-testid="rack-busy-a"]')).toBeNull();
		expect(btn.disabled).toBe(true);
	});

	it('floorBounce (the DSH restart chain owns the floor) disables the verb even when idle', async () => {
		const onremove = vi.fn();
		const { target } = mountComponent(PluginManagerUninstall, {
			plugin: { id: 'a', installed: true },
			busyId: null,
			floorBounce: true,
			onremove
		});
		const btn = target.querySelector('[data-testid="rack-uninstall-a"]') as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
	});

	it('a NOT-installed plugin renders no verb at all', async () => {
		const onremove = vi.fn();
		const { target } = mountComponent(PluginManagerUninstall, {
			plugin: { id: 'dsh-rules-paths', installed: false },
			onremove
		});
		expect(target.querySelector('[data-testid="rack-uninstall-dsh-rules-paths"]')).toBeNull();
	});
});

describe('PluginManagerHeaderActions', () => {
	it('clicking the fold pill fires oncollapseall (left) and onexpandall (right)', async () => {
		const oncollapseall = vi.fn();
		const onexpandall = vi.fn();
		const onreload = vi.fn();
		const { target } = mountComponent(PluginManagerHeaderActions, {
			loading: false,
			floorBounce: false,
			onreload,
			oncollapseall,
			onexpandall
		});
		expect(target.querySelector('[data-testid="rack-fold-toggle"]')).toBeTruthy();
		(target.querySelector('[data-testid="rack-collapse-all"]') as HTMLButtonElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-expand-all"]') as HTMLButtonElement).click();
		flushSync();
		expect(oncollapseall).toHaveBeenCalledTimes(1);
		expect(onexpandall).toHaveBeenCalledTimes(1);
		expect(onreload).not.toHaveBeenCalled();
	});

	it('the reload verb is enabled when idle and fires onreload', async () => {
		const onreload = vi.fn();
		const { target } = mountComponent(PluginManagerHeaderActions, {
			loading: false,
			floorBounce: false,
			onreload,
			oncollapseall: vi.fn(),
			onexpandall: vi.fn()
		});
		const reload = target.querySelector('[data-testid="rack-reload"]') as HTMLButtonElement;
		expect(reload.disabled).toBe(false);
		reload.click();
		flushSync();
		expect(onreload).toHaveBeenCalledTimes(1);
	});

	it('loading disables the reload verb and it does not fire', async () => {
		const onreload = vi.fn();
		const { target } = mountComponent(PluginManagerHeaderActions, {
			loading: true,
			floorBounce: false,
			onreload,
			oncollapseall: vi.fn(),
			onexpandall: vi.fn()
		});
		expect((target.querySelector('[data-testid="rack-reload"]') as HTMLButtonElement).disabled).toBe(true);
	});

	it('floorBounce (restart chain owns the floor) also disables the reload verb', async () => {
		const { target } = mountComponent(PluginManagerHeaderActions, {
			loading: false,
			floorBounce: true,
			onreload: vi.fn(),
			oncollapseall: vi.fn(),
			onexpandall: vi.fn()
		});
		expect((target.querySelector('[data-testid="rack-reload"]') as HTMLButtonElement).disabled).toBe(true);
	});
});
