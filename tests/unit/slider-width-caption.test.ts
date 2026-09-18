/**
 * SliderWidth unit tests — the caption's nullish guard (the one branch
 * slider-width.test.ts cannot reach: its thumbs always carry numbers,
 * and a range input sanitizes an empty value to the numeric midpoint,
 * so no thumb interaction can null the bound preset).
 *
 * A parent CAN hand the tray a nullish preset across the binding (the
 * prop type is number, but nothing at runtime re-materializes it), and
 * the caption template guards against exactly that:
 *  - a nullish bound value renders the bare "px" suffix — never "nullpx"
 *  - the next thumb move restores the honest "N px" caption and the
 *    per-move commit carries the number again
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SliderWidth from '$lib/components/panels/control-bar/SliderWidth.svelte';

function mountSlider(props: { value?: number | null }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onresizeall = vi.fn<(width: number) => void>();
	// The nullish case crosses the prop's number contract on purpose —
	// the caption's compiled `?? ''` guard is the behavior under test.
	const instance = mount(SliderWidth, {
		target,
		props: {
			onresizeall,
			value: props.value as number
		}
	});
	flushSync();
	return { target, instance, onresizeall };
}

const input = (target: HTMLElement): HTMLInputElement =>
	target.querySelector('[data-testid="controlbar-slider-width-input"]') as HTMLInputElement;

const caption = (target: HTMLElement): string =>
	target.querySelector('[data-testid="controlbar-slider-width-value"]')?.textContent ?? '';

/** Drives a thumb move exactly like the browser: set value, fire input. */
const move = (el: HTMLInputElement, value: string): void => {
	el.value = value;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
};

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SliderWidth — nullish bound value degrades the caption, never "nullpx"', () => {
	it('a null bound preset renders the bare "px" suffix through the nullish guard', () => {
		const { target, instance } = mountSlider({ value: null });
		expect(caption(target)).toBe('px');
		unmount(instance);
	});

	it('an undefined bound preset falls back to the PANEL_DEFAULT_WIDTH caption', () => {
		const { target, instance } = mountSlider({ value: undefined });
		expect(caption(target)).toBe('730px');
		unmount(instance);
	});

	it('the next thumb move after a nullish preset restores caption and commit', () => {
		const { target, instance, onresizeall } = mountSlider({ value: null });
		move(input(target), '720');
		expect(caption(target)).toBe('720px');
		expect(onresizeall).toHaveBeenCalledTimes(1);
		expect(onresizeall).toHaveBeenCalledWith(720);
		unmount(instance);
	});
});
