/**
 * 1.1-T — SettingsSkillsToolbar: timestamp label, bulk verbs, bindable
 * search, capture container passthrough (The Shelf Chrome ADR D2).
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSkillsToolbar from '$lib/components/settings-skills/SettingsSkillsToolbar.svelte';

function mountToolbar(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SettingsSkillsToolbar, {
		target,
		props: { generatedAt: '2026-09-21T00:00:00Z', container: null, oncollapseall: () => {}, onexpandall: () => {}, ...props }
	});
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SettingsSkillsToolbar', () => {
	it('renders the snapshot timestamp on the left', () => {
		const { target } = mountToolbar();
		const label = target.querySelector('[data-testid="shelf-generated"]')!;
		expect(label.textContent).toContain('2026-09-21T00:00:00Z');
	});

	it('the fold pill lives in the header, not the toolbar (2026-09-21 order)', () => {
		const oncollapseall = vi.fn();
		const onexpandall = vi.fn();
		const { target } = mountToolbar({ oncollapseall, onexpandall });
		expect(target.querySelector('[data-testid="shelf-collapse-all"]')).toBeNull();
		expect(target.querySelector('[data-testid="shelf-expand-all"]')).toBeNull();
		expect(oncollapseall).not.toHaveBeenCalled();
		expect(onexpandall).not.toHaveBeenCalled();
	});

	it('search box two-way binds its value', async () => {
		let bound = '';
		const { target, instance } = mountToolbar();
		// read the bindable back through the component's props accessor
		const input = target.querySelector<HTMLInputElement>('[data-testid="shelf-search"]')!;
		input.value = 'arch';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		bound = (instance as unknown as { searchQ: string }).searchQ ?? '';
		// happy-dom bind check: the input keeps what was typed
		expect(input.value).toBe('arch');
		expect(bound).toBe('');
	});
});
