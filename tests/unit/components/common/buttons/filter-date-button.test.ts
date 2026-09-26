/**
 * FilterDateButton unit tests (2026-09-04, the OCI port's coverage lane):
 * the badge's both states (inactive `filter` / active `MM-DD` + ×), the
 * calendar toggle (open on badge click, close on Escape and on the
 * picker's own close), the pick and clear reports ('' = cleared), and
 * the day-dot data reaching the grid.
 *
 * Pattern: direct mount (editing-title.test.ts) with per-test props —
 * no fetch, no store; the component is purely presentational.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FilterDateButton from '$lib/components/common/buttons/FilterDateButton.svelte';

afterEach(() => {
	vi.restoreAllMocks();
});

async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await Promise.resolve();
	}
	// One macrotask hop: the click-outside listeners attach on a
	// setTimeout(0) after the calendar opens.
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}

function mountButton(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onchange = vi.fn();
	const comp = mount(FilterDateButton, {
		target,
		props: { onchange, today: '2026-09-04', ...props } as never
	});
	flushSync();
	return { target, onchange, cleanup: () => { unmount(comp); target.remove(); } };
}

function trigger(target: HTMLElement): HTMLButtonElement {
	return target.querySelector('button[aria-label="Filter sessions by date"]') as HTMLButtonElement;
}

function dialog(target: HTMLElement): HTMLElement | null {
	return target.querySelector('[role="dialog"][aria-label="Date picker"]');
}

function dayButton(target: HTMLElement, day: string): HTMLButtonElement | null {
	const buttons = Array.from(target.querySelectorAll('[role="dialog"] button'));
	return (buttons.find((b) => b.textContent?.trim() === day) as HTMLButtonElement | undefined) ?? null;
}

describe('FilterDateButton — badge states', () => {
	it('inactive: the badge is the calendar-days glyph, no clear button, no calendar', () => {
		const h = mountButton();
		// The glyph replaced the word `filter` (2026-09-04) — the trigger
		// carries an svg and no text label.
		expect(trigger(h.target).querySelector('svg')).not.toBeNull();
		expect(trigger(h.target).textContent?.trim()).toBe('');
		expect(h.target.querySelector('button[data-clear-date]')).toBeNull();
		expect(dialog(h.target)).toBeNull();
		h.cleanup();
	});

	it('active: the badge reads MM-DD (value.slice(5)) with a clear button', () => {
		const h = mountButton({ value: '2026-09-04' });
		expect(trigger(h.target).textContent?.trim()).toBe('09-04');
		expect(h.target.querySelector('button[data-clear-date]')).not.toBeNull();
		h.cleanup();
	});
});

describe('FilterDateButton — the calendar', () => {
	it('badge click toggles the calendar open and closed', async () => {
		const h = mountButton({ dates: new Set(['2026-09-15']) });
		trigger(h.target).click();
		await settle();
		expect(dialog(h.target)).not.toBeNull();
		// The dot data reached the grid: the 15th carries a dot span.
		const day15 = dayButton(h.target, '15');
		expect(day15).not.toBeNull();
		expect(day15!.querySelector('.cal-dot')).not.toBeNull();
		trigger(h.target).click();
		await settle();
		expect(dialog(h.target)).toBeNull();
		h.cleanup();
	});

	it('picking a day reports it upward and closes nothing by itself', async () => {
		const h = mountButton();
		trigger(h.target).click();
		await settle();
		dayButton(h.target, '15')!.click();
		await settle();
		expect(h.onchange).toHaveBeenCalledWith('2026-09-15');
		// The badge is the only closer — the calendar stays open so the
		// operator can flip months; the owner's value flip unmounts the
		// ×-less state through the prop.
		expect(dialog(h.target)).not.toBeNull();
		h.cleanup();
	});

	it('picking the SELECTED day toggles it off (onchange with "")', async () => {
		const h = mountButton({ value: '2026-09-15' });
		trigger(h.target).click();
		await settle();
		dayButton(h.target, '15')!.click();
		await settle();
		expect(h.onchange).toHaveBeenCalledWith('');
		h.cleanup();
	});

	it('the × clears: onchange("") and the calendar closes', async () => {
		const h = mountButton({ value: '2026-09-15' });
		trigger(h.target).click();
		await settle();
		(h.target.querySelector('button[data-clear-date]') as HTMLButtonElement).click();
		await settle();
		expect(h.onchange).toHaveBeenCalledWith('');
		expect(dialog(h.target)).toBeNull();
		h.cleanup();
	});

	it('the calendar footer Clear filter reports "" (the calendar stays open — OCI parity; Escape closes)', async () => {
		const h = mountButton({ value: '2026-09-15' });
		trigger(h.target).click();
		await settle();
		const clear = Array.from(h.target.querySelectorAll('button')).find(
			(b) => b.textContent?.trim() === 'Clear filter'
		) as HTMLButtonElement;
		expect(clear).not.toBeUndefined();
		clear.click();
		await settle();
		expect(h.onchange).toHaveBeenCalledWith('');
		expect(dialog(h.target)).not.toBeNull(); // OCI parity: only Esc/× close
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await settle();
		expect(dialog(h.target)).toBeNull();
		h.cleanup();
	});

	it('Escape closes the calendar', async () => {
		const h = mountButton();
		trigger(h.target).click();
		await settle(); // listeners attach on the macrotask hop
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await settle();
		expect(dialog(h.target)).toBeNull();
		h.cleanup();
	});

	it('without an onchange handler the calendar still opens and picks safely', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(FilterDateButton, { target, props: { today: '2026-09-04' } });
		flushSync();
		trigger(target).click();
		await settle();
		expect(dialog(target)).not.toBeNull();
		expect(() => dayButton(target, '15')!.click()).not.toThrow();
		await settle();
		expect(dialog(target)).not.toBeNull();
		unmount(comp);
		target.remove();
	});

	it('a non-Escape document keydown while open does nothing; a click inside the calendar never closes it', async () => {
		const h = mountButton({ value: '2026-09-15' });
		trigger(h.target).click();
		await settle();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
		await settle();
		expect(dialog(h.target)).not.toBeNull();
		// A click on a day INSIDE the picker: the container contains the
		// target, so the outside-close guard leaves it open.
		dayButton(h.target, '20')!.click();
		await settle();
		expect(dialog(h.target)).not.toBeNull();
		// A synthetic click whose target is the Document (not an Element)
		// is tolerated — no throw, no close.
		document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await settle();
		expect(() => expect(dialog(h.target)).not.toBeNull()).not.toThrow();
		h.cleanup();
	});

	it('the × clears without an onchange handler (no throw)', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(FilterDateButton, {
			target,
			props: { value: '2026-09-15', today: '2026-09-04' }
		});
		flushSync();
		trigger(target).click();
		await settle();
		expect(() =>
			(target.querySelector('button[data-clear-date]') as HTMLButtonElement).click()
		).not.toThrow();
		await settle();
		expect(dialog(target)).toBeNull();
		unmount(comp);
		target.remove();
	});

	it('a click outside closes the calendar', async () => {
		const h = mountButton();
		trigger(h.target).click();
		await settle();
		document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await settle();
		expect(dialog(h.target)).toBeNull();
		h.cleanup();
	});
});
