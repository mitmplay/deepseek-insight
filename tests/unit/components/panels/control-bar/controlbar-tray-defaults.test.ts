/**
 * ControlBarTray unit tests — the tray BODY mounted directly (the parent
 * ControlBar always passes panelWidth/zoom, so the tray's $bindable
 * DEFAULTS have never run under test; controlbar-tray.test.ts and
 * panels-row.test.ts cover the tray through its parent).
 *
 * Pins, with neither bindable prop supplied:
 *  - the tray mounts all three floor controls (AddPanel, SliderWidth,
 *    SliderZoom — ADR-0006 R7) plus the TrayButtons row with its
 *    canvas-capture button
 *  - the omitted width lands on PANEL_DEFAULT_WIDTH (730px caption)
 *  - the omitted zoom lands on PANEL_DEFAULT_ZOOM (100% caption)
 *  - the sliders still mirror the config bounds and commit through the
 *    tray's onresizeall pass-through on every thumb move
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ControlBarTray from '$lib/components/panels/control-bar/ControlBarTray.svelte';
import {
	PANEL_DEFAULT_WIDTH,
	PANEL_DEFAULT_ZOOM,
	PANEL_MAX_WIDTH,
	PANEL_MAX_ZOOM,
	PANEL_MIN_WIDTH,
	PANEL_MIN_ZOOM
} from '$lib/utils/panel-prefs';

/** Mount with ONLY the required prop — both $bindable defaults must apply. */
function mountTray() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onresizeall = vi.fn<(width: number) => void>();
	const instance = mount(ControlBarTray, { target, props: { onresizeall } });
	flushSync();
	return { target, instance, onresizeall };
}

const widthInput = (target: HTMLElement): HTMLInputElement =>
	target.querySelector('[data-testid="controlbar-slider-width-input"]') as HTMLInputElement;

const widthCaption = (target: HTMLElement): string =>
	target.querySelector('[data-testid="controlbar-slider-width-value"]')?.textContent ?? '';

const zoomInput = (target: HTMLElement): HTMLInputElement =>
	target.querySelector('[data-testid="controlbar-slider-zoom-input"]') as HTMLInputElement;

const zoomCaption = (target: HTMLElement): string =>
	target.querySelector('[data-testid="controlbar-slider-zoom-value"]')?.textContent ?? '';

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ControlBarTray — floor controls mount with panel-prefs defaults', () => {
	it('mounts the tray group with AddPanel, SliderWidth, SliderZoom, and the TrayButtons row inside', () => {
		const { target, instance } = mountTray();
		const tray = target.querySelector('[data-testid="controlbar-tray"]') as HTMLElement;
		expect(tray).not.toBeNull();
		expect(tray.getAttribute('role')).toBe('group');
		expect(tray.getAttribute('aria-label')).toBe('Floor controls');
		expect(target.querySelector('[data-testid="controlbar-add-input"]')).not.toBeNull();
		expect(widthInput(target)).not.toBeNull();
		expect(zoomInput(target)).not.toBeNull();
		// The buttons row mounts with the capture button (captureContainer
		// defaults to null — the SSR-safe no-op; render-on-click is
		// TrayButtons' own test's contract), and leads the tray — the row
		// sits above the controls (2026-09-07).
		const buttonsRow = target.querySelector('[data-testid="controlbar-tray-buttons"]') as HTMLElement;
		expect(buttonsRow).not.toBeNull();
		expect(target.querySelector('[data-testid="canvas-copy-button"]')).not.toBeNull();
		const addInput = target.querySelector('[data-testid="controlbar-add-input"]') as HTMLElement;
		expect(buttonsRow.compareDocumentPosition(addInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		unmount(instance);
	});

	it('the omitted width prop lands on PANEL_DEFAULT_WIDTH', () => {
		const { target, instance } = mountTray();
		expect(widthCaption(target)).toBe(`${PANEL_DEFAULT_WIDTH}px`);
		expect(widthInput(target).value).toBe(String(PANEL_DEFAULT_WIDTH));
		unmount(instance);
	});

	it('the omitted zoom prop lands on PANEL_DEFAULT_ZOOM', () => {
		const { target, instance } = mountTray();
		expect(zoomCaption(target)).toBe(`${Math.round(PANEL_DEFAULT_ZOOM * 100)}%`);
		expect(zoomInput(target).value).toBe(String(PANEL_DEFAULT_ZOOM));
		unmount(instance);
	});

	it('both sliders mirror the config bounds even on defaulted props', () => {
		const { target, instance } = mountTray();
		expect(Number(widthInput(target).min)).toBe(PANEL_MIN_WIDTH);
		expect(Number(widthInput(target).max)).toBe(PANEL_MAX_WIDTH);
		expect(Number(zoomInput(target).min)).toBe(PANEL_MIN_ZOOM);
		expect(Number(zoomInput(target).max)).toBe(PANEL_MAX_ZOOM);
		unmount(instance);
	});
});

describe('ControlBarTray — pass-through wiring on defaulted props', () => {
	it('a width thumb move commits through the tray onresizeall and updates the caption', () => {
		const { target, instance, onresizeall } = mountTray();
		const input = widthInput(target);
		input.value = '600';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onresizeall).toHaveBeenCalledTimes(1);
		expect(onresizeall).toHaveBeenCalledWith(600);
		expect(widthCaption(target)).toBe('600px');
		unmount(instance);
	});

	it('a zoom thumb move flows into the zoom binding (caption follows live)', () => {
		const { target, instance } = mountTray();
		const input = zoomInput(target);
		input.value = '0.9';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(zoomCaption(target)).toBe('90%');
		unmount(instance);
	});
});
