/**
 * SettingsSkillsTabgroup tests (The Shelf Chrome D3): the shelf's own
 * pill speaks install/uninstall natively, PLAIN labels — no counts.
 */
import { flushSync } from 'svelte';
import { mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSkillsTabgroup from '$lib/components/panels/SettingsSkillsTabgroup.svelte';

function mountGroup(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(SettingsSkillsTabgroup, { target, props });
	flushSync();
	return target;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SettingsSkillsTabgroup', () => {
	it('defaults to the install segment with plain labels (no counts)', () => {
		const target = mountGroup();
		const install = target.querySelector('[data-testid="shelf-tab-install"]')!;
		expect(install.classList.contains('on')).toBe(true);
		expect(install.textContent!.trim()).toBe('Install');
		expect(target.querySelector('[data-testid="shelf-tab-uninstall"]')!.textContent!.trim()).toBe('Uninstall');
		expect(install.textContent).not.toContain('(');
	});

	it('reports native install/uninstall intents', () => {
		const ontabchange = vi.fn();
		const target = mountGroup({ ontabchange });
		target.querySelector<HTMLButtonElement>('[data-testid="shelf-tab-uninstall"]')!.click();
		flushSync();
		expect(ontabchange).toHaveBeenCalledWith('uninstall');
	});
});
