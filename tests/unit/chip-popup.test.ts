/**
 * ChipPopup unit tests — the expanded-chip container rendered after the
 * chip row: default vs explicit chrome props, in-flow children, and the
 * `scroller` bindable landing the root element in the host's state.
 */
import { createRawSnippet, flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import type { Snippet } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ChipPopup from '$lib/components/message/ChipPopup.svelte';
import ChipPopupHost from '../fixtures/ChipPopupHost.svelte';

/** ChipPopup's prop shape (inline — svelte-check's ComponentProps drifts). */
type ChipPopupProps = {
	children: Snippet;
	border?: string;
	maxHeight?: string;
	scroller?: HTMLElement | null;
};

/** A single-root snippet (multi-root render snippets trip a Svelte warning). */
function popupSnippet(): ReturnType<typeof createRawSnippet> {
	return createRawSnippet(() => ({
		render: () => '<p data-testid="chip-popup-content">popup body</p>'
	}));
}

function mountPopup(props: ChipPopupProps) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ChipPopup, { target, props });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ChipPopup — the expanded-chip container', () => {
	it('default chrome: the OCI height cap and the plain surface border', () => {
		const { target, instance } = mountPopup({ children: popupSnippet() });
		const popup = target.querySelector('[data-testid="chip-popup"]') as HTMLElement;
		expect(popup.className).toContain('max-h-80');
		expect(popup.className).toContain('border-surface-border');
		unmount(instance);
	});

	it('explicit chrome props replace the defaults (taller cap, tinted border)', () => {
		const { target, instance } = mountPopup({
			children: popupSnippet(),
			maxHeight: 'max-h-[30rem]',
			border: 'border-amber-300'
		});
		const popup = target.querySelector('[data-testid="chip-popup"]') as HTMLElement;
		expect(popup.className).toContain('max-h-[30rem]');
		expect(popup.className).not.toContain('max-h-80');
		expect(popup.className).toContain('border-amber-300');
		unmount(instance);
	});

	it('renders its children in-flow below the chip row', () => {
		const { target, instance } = mountPopup({ children: popupSnippet() });
		expect(target.querySelector('[data-testid="chip-popup-content"]')?.textContent).toBe(
			'popup body'
		);
		unmount(instance);
	});

	it('explicitly nullish chrome props degrade to empty class chunks (compiled ?? fallbacks)', () => {
		const { target, instance } = mountPopup({
			children: popupSnippet(),
			maxHeight: null as unknown as string,
			border: null as unknown as string
		});
		const popup = target.querySelector('[data-testid="chip-popup"]') as HTMLElement;
		expect(popup.className).not.toContain('null');
		expect(popup.className).not.toContain('undefined');
		unmount(instance);
	});

	it('binds the scroll box out to the host (the stick-to-bottom attach point)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(ChipPopupHost, { target });
		flushSync();
		expect(target.querySelector('[data-testid="chip-popup-bound"]')?.textContent).toBe('bound');
		expect(target.querySelector('[data-testid="chip-popup"]')).not.toBeNull();
		unmount(instance);
	});
});
