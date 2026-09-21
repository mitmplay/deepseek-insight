/**
 * 1.3-T — SettingsSkillsContainer: children render inside the scroll box.
 */
import { flushSync } from 'svelte';
import { mount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SettingsSkillsContainerHost from './SettingsSkillsContainerHost.svelte';

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SettingsSkillsContainer', () => {
	it('renders children inside the scroll box', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(SettingsSkillsContainerHost, { target });
		flushSync();
		expect(target.querySelector('[data-testid="shelf-container"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="container-inner"]')).not.toBeNull();
	});
});
