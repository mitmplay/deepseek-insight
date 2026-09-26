/**
 * ControlBar tray lifecycle unit tests — the hover/focus/keyboard
 * behavior around the tray (panels-row.test.ts covers the tray's
 * CONTENTS: paste-add, sliders, ADR-0006 R7 absences; this file pins
 * the reveal/hide state machine itself).
 *
 *   hover in  → reveal now, cancel any pending hide (grazing keeps it)
 *   hover out → hide after the 250ms grace (timer, not immediate)
 *   focus     → focusin reveals; focusout hides only when focus leaves
 *               the WHOLE tray (tabbing trigger→input is navigation)
 *   Escape    → closes now and clears the pending hide
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ControlBar from '$lib/components/panels/control-bar/ControlBar.svelte';

function renderBar(): { target: HTMLElement; bar: HTMLElement; trigger: HTMLElement; unmount: () => void } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(ControlBar, { target, props: { onresizeall: () => {} } });
	const bar = target.querySelector('[data-testid="controlbar"]') as HTMLElement;
	const trigger = target.querySelector('[data-testid="controlbar-trigger"]') as HTMLElement;
	return { target, bar, trigger, unmount: () => unmount(comp) };
}

const isOpen = (bar: HTMLElement): boolean => bar.getAttribute('data-open') === 'true';
const tray = (target: HTMLElement): HTMLElement | null => target.querySelector('[data-testid="controlbar-tray"]');

const mouse = (type: string, el: HTMLElement): void => {
	el.dispatchEvent(new MouseEvent(type, { bubbles: false, cancelable: true }));
	flushSync();
};

const focusOut = (bar: HTMLElement, relatedTarget: EventTarget | null): void => {
	// bubbles: true — Svelte's delegated listeners live at the document.
	bar.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget }));
	flushSync();
};

describe('ControlBar tray — hover lifecycle', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		document.body.innerHTML = '';
	});

	it('starts closed; mouseenter on the bar reveals the tray immediately', () => {
		const { bar } = renderBar();
		expect(isOpen(bar)).toBe(false);
		mouse('mouseenter', bar);
		expect(isOpen(bar)).toBe(true);
		expect(tray(document.body)).not.toBeNull();
	});

	it('mouseleave schedules the hide — tray survives the grace, closes after 250ms', async () => {
		const { target, bar } = renderBar();
		mouse('mouseenter', bar);
		mouse('mouseleave', bar);
		expect(isOpen(bar)).toBe(true); // still open inside the grace window
		await vi.advanceTimersByTimeAsync(250);
		flushSync();
		expect(isOpen(bar)).toBe(false);
		expect(tray(target)).toBeNull();
	});

	it('re-entering within the grace cancels the hide (grazing the tray keeps it open)', async () => {
		const { bar } = renderBar();
		mouse('mouseenter', bar);
		mouse('mouseleave', bar);
		mouse('mouseenter', bar); // re-enter before the 250ms lands
		await vi.advanceTimersByTimeAsync(1000);
		flushSync();
		expect(isOpen(bar)).toBe(true);
	});

	it('a second mouseleave replaces the pending hide (no double timers)', async () => {
		const { bar } = renderBar();
		mouse('mouseenter', bar);
		mouse('mouseleave', bar);
		await vi.advanceTimersByTimeAsync(200); // inside first grace
		mouse('mouseleave', bar); // re-arm
		await vi.advanceTimersByTimeAsync(100); // 300ms since first, 100 since re-arm
		flushSync();
		expect(isOpen(bar)).toBe(true); // first timer was cleared
		await vi.advanceTimersByTimeAsync(160);
		flushSync();
		expect(isOpen(bar)).toBe(false); // re-armed timer fired
	});
});

describe('ControlBar tray — keyboard + focus lifecycle', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		document.body.innerHTML = '';
	});

	it('Escape closes the open tray immediately', () => {
		const { target, bar } = renderBar();
		mouse('mouseenter', bar);
		bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(isOpen(bar)).toBe(false);
		expect(tray(target)).toBeNull();
	});

	it('Escape also clears a pending hide (mouseleave → Escape → timer fires as no-op)', async () => {
		const { bar } = renderBar();
		mouse('mouseenter', bar);
		mouse('mouseleave', bar); // hide pending
		bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(isOpen(bar)).toBe(false);
		// The stale timer must not re-open or throw when it lands.
		await vi.advanceTimersByTimeAsync(400);
		flushSync();
		expect(isOpen(bar)).toBe(false);
	});

	it('a non-Escape key is ignored (open tray stays open)', () => {
		const { bar } = renderBar();
		mouse('mouseenter', bar);
		bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
		flushSync();
		expect(isOpen(bar)).toBe(true);
	});

	it('focusin reveals (keyboard access without hover)', () => {
		const { bar } = renderBar();
		bar.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		flushSync();
		expect(isOpen(bar)).toBe(true);
	});

	it('focusout to a target INSIDE the bar is navigation — no hide scheduled', async () => {
		const { bar, trigger } = renderBar();
		mouse('mouseenter', bar);
		const inside = document.createElement('input');
		bar.appendChild(inside);
		focusOut(bar, inside); // tabbing trigger → tray input
		await vi.advanceTimersByTimeAsync(400);
		flushSync();
		expect(isOpen(bar)).toBe(true);
		expect(trigger).toBeDefined();
	});

	it('focusout to a target OUTSIDE the bar hides after the grace', async () => {
		const { bar } = renderBar();
		mouse('mouseenter', bar);
		const elsewhere = document.createElement('button');
		document.body.appendChild(elsewhere);
		focusOut(bar, elsewhere);
		await vi.advanceTimersByTimeAsync(250);
		flushSync();
		expect(isOpen(bar)).toBe(false);
	});

	it('focusout with no relatedTarget (blur to nothing) hides after the grace', async () => {
		const { bar } = renderBar();
		mouse('mouseenter', bar);
		focusOut(bar, null);
		await vi.advanceTimersByTimeAsync(250);
		flushSync();
		expect(isOpen(bar)).toBe(false);
	});
});
