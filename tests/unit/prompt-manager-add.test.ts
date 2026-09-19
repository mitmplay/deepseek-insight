/**
 * PromptManagerAdd unit tests: every branch of the portal action
 * (inert host vs body portal + destroy cleanup), both save/cancel event
 * handlers plus the backdrop click-to-cancel, and the $bindable round-trip
 * of text/label/tags with the textarea row auto-sizing expression.
 *
 * Mounts the component directly (no fetch boundary — the panel owns the POST).
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PromptManagerAdd from '$lib/components/prompt-manager/PromptManagerAdd.svelte';
import type { ComponentProps } from 'svelte';
import PromptManagerAddHost from './PromptManagerAddHost.svelte';

afterEach(() => {
	document.body.innerHTML = '';
});

function mountAdd(props: Partial<ComponentProps<typeof PromptManagerAdd>>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PromptManagerAdd, {
		target,
		props: { text: '', label: '', tags: '', ...props } as ComponentProps<typeof PromptManagerAdd>
	});
	flushSync();
	return { target, instance };
}

describe('PromptManagerAdd', () => {
	it('renders in place when portal is false (inert branch of the action)', () => {
		const onsave = vi.fn();
		const oncancel = vi.fn();
		const { target, instance } = mountAdd({ text: '', label: '', tags: '', portal: false, onsave, oncancel });

		// The wrapper div stays inside the mount target — no body append.
		const wrapper = target.querySelector('.mgr-edit-portal');
		expect(wrapper).not.toBeNull();
		expect(document.body.querySelector(':scope > .mgr-edit-portal')).toBeNull();

		expect(target.querySelector('.mgr-edit-dialog')).not.toBeNull();
		expect(target.querySelector('.mgr-edit-backdrop')).not.toBeNull();
		expect(target.querySelector('h3')?.textContent).toBeTruthy();

		// Field sequence mirrors PromptManagerEdit: uses+macro pair, label,
		// text, tags — one form grammar across the manager's dialogs.
		const seq = [...target.querySelectorAll('.mgr-edit-dialog input, .mgr-edit-dialog textarea')].map(
			(el) => (el as HTMLElement).className.split(' ')[0]
		);
		expect(seq).toEqual(['mgr-edit-uses', 'mgr-edit-macro', 'mgr-add-label', 'mgr-add-text', 'mgr-add-tags']);

		unmount(instance);
	});

	it('save and cancel buttons invoke the matching callbacks', () => {
		const onsave = vi.fn();
		const oncancel = vi.fn();
		const { target, instance } = mountAdd({ text: '', label: '', tags: '', portal: false, onsave, oncancel });

		(target.querySelector('.mgr-btn-save') as HTMLButtonElement).click();
		flushSync();
		expect(onsave).toHaveBeenCalledTimes(1);
		expect(oncancel).not.toHaveBeenCalled();

		(target.querySelector('.mgr-btn-cancel') as HTMLButtonElement).click();
		flushSync();
		expect(oncancel).toHaveBeenCalledTimes(1);
		expect(onsave).toHaveBeenCalledTimes(1);

		unmount(instance);
	});

	it('backdrop click cancels', () => {
		const onsave = vi.fn();
		const oncancel = vi.fn();
		const { target, instance } = mountAdd({ text: '', label: '', tags: '', portal: false, onsave, oncancel });

		(target.querySelector('.mgr-edit-backdrop') as HTMLElement).click();
		flushSync();
		expect(oncancel).toHaveBeenCalledTimes(1);
		expect(onsave).not.toHaveBeenCalled();

		unmount(instance);
	});

	it('bindable props round-trip: typing updates text/label/tags', () => {
		const onsave = vi.fn();
		const oncancel = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PromptManagerAddHost, { target, props: { onsave, oncancel, portal: false } });
		flushSync();

		const mirror = () => target.querySelector('[data-testid="mirror"]') as HTMLElement;
		const uses = target.querySelector('.mgr-edit-uses') as HTMLInputElement;
		uses.value = '7';
		uses.dispatchEvent(new Event('input', { bubbles: true }));
		const macro = target.querySelector('.mgr-edit-macro') as HTMLInputElement;
		macro.click();
		flushSync();
		expect(mirror().dataset.uses).toBe('7');
		expect(mirror().dataset.macro).toBe('1');
		const ta = target.querySelector('.mgr-add-text') as HTMLTextAreaElement;
		ta.value = 'hello\nworld';
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		const label = target.querySelector('.mgr-add-label') as HTMLInputElement;
		label.value = 'greeting';
		label.dispatchEvent(new Event('input', { bubbles: true }));
		const tags = target.querySelector('.mgr-add-tags') as HTMLInputElement;
		tags.value = 'a, b';
		tags.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		expect(mirror().dataset.text).toBe('hello\nworld');
		expect(mirror().dataset.label).toBe('greeting');
		expect(mirror().dataset.tags).toBe('a, b');

		// Row auto-sizing clamps: 2 lines -> min 3; 99 lines -> max 10.
		expect(Number(ta.getAttribute('rows'))).toBe(3);
		ta.value = Array.from({ length: 99 }, () => 'x').join('\n');
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(Number(ta.getAttribute('rows'))).toBe(10);

		unmount(instance);
	});

	it('portal=true appends the wrapper to document.body and unmount removes it (destroy branch)', () => {
		const onsave = vi.fn();
		const oncancel = vi.fn();
		const { target, instance } = mountAdd({ text: '', label: '', tags: '', portal: true, onsave, oncancel });

		const wrapper = document.body.querySelector(':scope > .mgr-edit-portal');
		expect(wrapper, 'dialog pair portaled to body').not.toBeNull();
		expect(target.querySelector('.mgr-edit-portal')).toBeNull();
		expect(wrapper!.querySelector('.mgr-edit-dialog')).not.toBeNull();

		// Handlers still fire through the portal.
		(wrapper!.querySelector('.mgr-btn-save') as HTMLButtonElement).click();
		flushSync();
		expect(onsave).toHaveBeenCalledTimes(1);

		unmount(instance);
		expect(document.body.querySelector(':scope > .mgr-edit-portal'), 'destroy removed the portal node').toBeNull();
	});
});
