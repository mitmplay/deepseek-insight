/**
 * SliderWidth unit tests — the tray's uniform-width control.
 *
 * Direct mount (panels-row.test.ts exercises it only through the
 * ControlBarHarness tray): pins the component's own contract —
 *
 *  - the bindable value prop is OPTIONAL: the default lands on
 *    PANEL_DEFAULT_WIDTH (the $bindable fallback branch)
 *  - the caption tracks the bound preset live ("N px")
 *  - min/max mirror the config bounds (the same source the single
 *    clamp site reads — app-config defaults here)
 *  - the commit fires onresizeall on EVERY thumb move (input),
 *    realtime like SliderZoom, carrying the live-tracked value
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SliderWidth from '$lib/components/panels/control-bar/SliderWidth.svelte';
import {
	PANEL_DEFAULT_WIDTH,
	PANEL_MAX_WIDTH,
	PANEL_MIN_WIDTH
} from '$lib/utils/panel-prefs';

function mountSlider(props: { value?: number; onresizeall?: (width: number) => void } = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onresizeall = props.onresizeall ?? vi.fn<(width: number) => void>();
	const instance = mount(SliderWidth, {
		target,
		props: {
			onresizeall,
			...(props.value !== undefined ? { value: props.value } : {})
		}
	});
	flushSync();
	return { target, instance, onresizeall };
}

function input(target: HTMLElement): HTMLInputElement {
	return target.querySelector('[data-testid="controlbar-slider-width-input"]') as HTMLInputElement;
}

function caption(target: HTMLElement): string {
	return target.querySelector('[data-testid="controlbar-slider-width-value"]')?.textContent ?? '';
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SliderWidth — value + bounds', () => {
	it('omitting the value prop lands on the PANEL_DEFAULT_WIDTH fallback', () => {
		const { target, instance } = mountSlider(); // no value prop
		expect(caption(target)).toBe(`${PANEL_DEFAULT_WIDTH}px`);
		expect(input(target).value).toBe(String(PANEL_DEFAULT_WIDTH));
		unmount(instance);
	});

	it('an explicit value renders in the caption', () => {
		const { target, instance } = mountSlider({ value: 600 });
		expect(caption(target)).toBe('600px');
		unmount(instance);
	});

	it('min/max mirror the config bounds (the single clamp site\'s constants)', () => {
		const { target, instance } = mountSlider();
		const el = input(target);
		expect(Number(el.min)).toBe(PANEL_MIN_WIDTH);
		expect(Number(el.max)).toBe(PANEL_MAX_WIDTH);
		expect(el.getAttribute('aria-label')).toBe('Panel width for all panels');
		expect(target.querySelector('[data-testid="controlbar-slider-width"]')).not.toBeNull();
		unmount(instance);
	});
});

describe('SliderWidth — live preview + realtime commit', () => {
	it('the bound preset tracks the thumb and commits onresizeall on every input', () => {
		const { target, instance, onresizeall } = mountSlider({ value: 600 });
		const el = input(target);
		// Drag the thumb — the caption follows live AND the commit fires
		// per move (realtime panels, SliderZoom's cadence).
		el.value = '700';
		el.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(caption(target)).toBe('700px');
		expect(onresizeall).toHaveBeenCalledTimes(1);
		expect(onresizeall).toHaveBeenCalledWith(700);
		unmount(instance);
	});

	it('a second drag reports the newest value', () => {
		const { target, instance, onresizeall } = mountSlider();
		const el = input(target);
		el.value = String(PANEL_MAX_WIDTH);
		el.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onresizeall).toHaveBeenCalledWith(PANEL_MAX_WIDTH);
		expect(caption(target)).toBe(`${PANEL_MAX_WIDTH}px`);
		unmount(instance);
	});
});
