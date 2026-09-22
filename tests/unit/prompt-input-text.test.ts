/**
 * PromptInputText unit tests — pins the contract of
 * PromptInputText.svelte (the composer textarea, extracted from
 * PromptInput 2026-09-04):
 *  - renders the pinned box: testid `prompt-textarea`, rows=2,
 *    data-max-rows;
 *  - the element binds BACK (the el getter sees the live node) — the
 *    owner's focus/autosize/selection contract survives the component
 *    boundary;
 *  - the draft binds back (typing flows through bind:value);
 *  - locked disables the box;
 *  - the placeholder swaps with isStreaming;
 *  - isOverflow picks the scroll class;
 *  - isStreaming/awaiting add the pr-7 indicator room; a non-empty unlocked draft reserves pr-4 (ClearIconButton room);
 *  - focus, blur and composition events report upward.
 *
 * Two-way harness: mount() needs GETTER/SETTER props for $bindable
 * write-back (a plain object never sees the child's writes) — `bound`
 * is where el/value land.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PromptInputText from '$lib/components/chat/PromptInputText.svelte';

function mountText(
	overrides: { isStreaming?: boolean; locked?: boolean; awaiting?: boolean; isOverflow?: boolean; value?: string } = {}
) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const bound = {
		el: undefined as HTMLTextAreaElement | undefined,
		value: overrides.value ?? 'draft'
	};
	const handlers = {
		onkeydown: vi.fn(),
		onpaste: vi.fn(),
		oninput: vi.fn(),
		onfocus: vi.fn(),
		onblur: vi.fn(),
		oncompositionstart: vi.fn(),
		oncompositionend: vi.fn()
	};
	const instance = mount(PromptInputText, {
		target,
		props: {
			get el() {
				return bound.el;
			},
			set el(next: HTMLTextAreaElement | undefined) {
				bound.el = next;
			},
			get value() {
				return bound.value;
			},
			set value(next: string) {
				bound.value = next;
			},
			maxRows: 8,
			isStreaming: overrides.isStreaming ?? false,
			locked: overrides.locked ?? false,
			awaiting: overrides.awaiting ?? false,
			isOverflow: overrides.isOverflow ?? false,
			...handlers
		}
	});
	flushSync();
	return { target, instance, bound, handlers };
}

const box = (target: HTMLElement): HTMLTextAreaElement =>
	target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;

afterEach(() => {
	document.body.innerHTML = '';
});

describe('PromptInputText — render', () => {
	it('renders the pinned box: testid, rows=2, data-max-rows, initial draft', () => {
		const { target, instance } = mountText();
		const ta = box(target);
		expect(ta.getAttribute('rows')).toBe('2');
		expect(ta.getAttribute('data-max-rows')).toBe('8');
		expect(ta.value).toBe('draft');
		unmount(instance);
	});

	it('binds the element back to the owner', () => {
		const { target, instance, bound } = mountText();
		expect(bound.el).toBe(box(target));
		unmount(instance);
	});

	it('typing flows the draft back through bind:value', () => {
		const { target, instance, bound } = mountText();
		const ta = box(target);
		ta.value = 'typed';
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(bound.value).toBe('typed');
		unmount(instance);
	});
});

describe('PromptInputText — reporting', () => {
	it('reports input, focus, blur and composition upward', () => {
		const { target, instance, handlers } = mountText();
		const ta = box(target);
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		ta.focus();
		ta.blur();
		ta.dispatchEvent(new CompositionEvent('compositionstart'));
		ta.dispatchEvent(new CompositionEvent('compositionend'));
		flushSync();
		expect(handlers.oninput).toHaveBeenCalled();
		expect(handlers.onfocus).toHaveBeenCalled();
		expect(handlers.onblur).toHaveBeenCalled();
		expect(handlers.oncompositionstart).toHaveBeenCalledTimes(1);
		expect(handlers.oncompositionend).toHaveBeenCalledTimes(1);
		unmount(instance);
	});
});

describe('PromptInputText — states', () => {
	it('locked disables the box', () => {
		const { target, instance } = mountText({ locked: true });
		expect(box(target).disabled).toBe(true);
		unmount(instance);
	});

	it('the placeholder swaps with isStreaming', () => {
		const idle = mountText({ isStreaming: false });
		expect(box(idle.target).placeholder).toContain('Send a prompt…');
		unmount(idle.instance);
		const live = mountText({ isStreaming: true });
		expect(box(live.target).placeholder).toContain('Turn in flight');
		unmount(live.instance);
	});

	it('isOverflow picks the scroll class', () => {
		const fits = mountText({ isOverflow: false });
		expect(box(fits.target).className).toContain('overflow-y-hidden');
		unmount(fits.instance);
		const full = mountText({ isOverflow: true });
		expect(box(full.target).className).toContain('overflow-y-auto');
		unmount(full.instance);
	});

	it('isStreaming/awaiting add the pr-7 indicator room', () => {
		const streaming = mountText({ isStreaming: true });
		expect(box(streaming.target).className).toContain('pr-7');
		unmount(streaming.instance);
		const awaiting = mountText({ awaiting: true });
		expect(box(awaiting.target).className).toContain('pr-7');
		unmount(awaiting.instance);
	});

	it('a non-empty unlocked draft reserves pr-4 (ClearIconButton room); empty reserves nothing', () => {
		// non-empty draft: pr-4 reserve + the clear button is rendered
		const drafted = mountText();
		expect(box(drafted.target).className).toContain('pr-4');
		expect(drafted.target.querySelector('button')).not.toBeNull();
		unmount(drafted.instance);

		// empty draft: no reserve, no clear button
		const empty = mountText({ value: '' });
		expect(box(empty.target).className).not.toContain('pr-4');
		expect(empty.target.querySelector('button')).toBeNull();
		unmount(empty.instance);
	});

	it('the ClearIconButton empties the draft back through bind:value', () => {
		const cleared = mountText();
		cleared.target.querySelector('button')!.click();
		flushSync();
		expect(cleared.bound.value).toBe('');
		unmount(cleared.instance);
	});
});
