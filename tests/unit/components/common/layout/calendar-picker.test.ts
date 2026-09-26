/**
 * CalendarPicker (2026-09-05): the date-grid contract — view init from
 * value/today/real clock, month nav with year rollover, pick and toggle-off,
 * Clear filter, Escape close, and the dot/today/selected day decoration.
 */
import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import CalendarPicker from '$lib/components/common/layout/CalendarPicker.svelte';

type Props = {
	value?: string;
	dates?: Set<string>;
	today?: string;
	onchange?: (date: string) => void;
	onclose?: () => void;
};

function mountPicker(props: Props) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(CalendarPicker, { target, props });
	flushSync();
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

const dayButtons = (t: HTMLElement) =>
	[...t.querySelectorAll('button.cal-day')] as HTMLButtonElement[];

describe('CalendarPicker', () => {
	it('initializes the view month from value; the selected day fills', () => {
		const h = mountPicker({ value: '2026-03-15' });
		expect(h.target.querySelector('.cal-month')?.textContent).toContain('March 2026');
		const sel = h.target.querySelector('button.cal-day.selected') as HTMLElement;
		expect(sel?.textContent?.trim()).toBe('15');
		h.cleanup();
	});

	it('initializes from the today prop when value is empty', () => {
		const h = mountPicker({ value: '', today: '2026-01-04' });
		expect(h.target.querySelector('.cal-month')?.textContent).toContain('January 2026');
		const today = h.target.querySelector('button.cal-day.today') as HTMLElement;
		expect(today?.textContent?.trim()).toBe('04');
		h.cleanup();
	});

	it('falls back to the real clock when neither value nor today is given', () => {
		const now = new Date();
		const h = mountPicker({ value: '', today: '' });
		expect(h.target.querySelector('.cal-month')?.textContent)
			.toBe(now.toLocaleDateString([], { month: 'long', year: 'numeric' }));
		h.cleanup();
	});

	it('prev/next navigate months and roll the year at the edges', () => {
		const mid = mountPicker({ value: '2026-03-31' });
		(mid.target.querySelector('[aria-label="Previous month"]') as HTMLButtonElement).click();
		flushSync();
		expect(mid.target.querySelector('.cal-month')?.textContent).toContain('February 2026');
		mid.cleanup();

		const h = mountPicker({ value: '2026-01-31' });
		(h.target.querySelector('[aria-label="Previous month"]') as HTMLButtonElement).click();
		flushSync();
		expect(h.target.querySelector('.cal-month')?.textContent).toContain('December 2025');
		(h.target.querySelector('[aria-label="Next month"]') as HTMLButtonElement).click();
		(h.target.querySelector('[aria-label="Next month"]') as HTMLButtonElement).click();
		flushSync();
		expect(h.target.querySelector('.cal-month')?.textContent).toContain('February 2026');
		(h.target.querySelector('[aria-label="Next month"]') as HTMLButtonElement).click();
		for (let i = 0; i < 10; i++)
			(h.target.querySelector('[aria-label="Next month"]') as HTMLButtonElement).click();
		flushSync();
		expect(h.target.querySelector('.cal-month')?.textContent).toContain('January 2027');
		h.cleanup();
	});

	it('picking a day emits it; clicking the selected day toggles it off', () => {
		const onchange = vi.fn();
		const h = mountPicker({ value: '', today: '2026-05-01', onchange });
		const may10 = dayButtons(h.target).find((b) => b.textContent?.trim() === '10')!;
		may10.click();
		flushSync();
		expect(onchange).toHaveBeenLastCalledWith('2026-05-10');
		h.cleanup();

		const h2 = mountPicker({ value: '2026-05-10', today: '2026-05-01', onchange });
		const selected = dayButtons(h2.target).find((b) => b.classList.contains('selected'))!;
		expect(selected.textContent?.trim()).toBe('10');
		selected.click();
		flushSync();
		expect(onchange).toHaveBeenLastCalledWith('');
		h2.cleanup();
	});

	it('Clear filter emits empty string and only exists while a value is set', () => {
		const onchange = vi.fn();
		const h = mountPicker({ value: '2026-05-10', today: '2026-05-01', onchange });
		(h.target.querySelector('button.cal-clear') as HTMLButtonElement).click();
		expect(onchange).toHaveBeenCalledWith('');
		h.cleanup();
		const bare = mountPicker({ value: '', today: '2026-05-01', onchange });
		expect(bare.target.querySelector('button.cal-clear')).toBeNull();
		bare.cleanup();
	});

	it('Escape closes; a dot marks days with sessions (never on the selected day)', () => {
		const onclose = vi.fn();
		const h = mountPicker({
			value: '2026-05-10',
			today: '2026-05-01',
			dates: new Set(['2026-05-10', '2026-05-20']),
			onclose
		});
		h.target.querySelector('.cal')!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
		);
		expect(onclose).toHaveBeenCalledTimes(1);
		const dots = [...h.target.querySelectorAll('.cal-dot')];
		expect(dots).toHaveLength(1);
		expect(dots[0].parentElement?.textContent?.trim()).toBe('20');
		h.cleanup();
	});

	it('days are clickable and non-Escape keys are ignored when handlers are absent', () => {
		// No onchange/onclose: clicks and keydowns must not throw
		const h = mountPicker({ value: '', today: '2026-05-01' });
		dayButtons(h.target)[0].click();
		h.target.querySelector('.cal')!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
		);
		flushSync();
		expect(h.target.querySelector('.cal-month')?.textContent).toContain('May 2026');
		h.cleanup();
	});

	it('leading and trailing empty cells render as spans, not buttons', () => {
		// February 2026 starts on a Sunday (no leading gap) — pick August 2026
		// (starts Saturday: 6 leading gaps) via month nav from today's prop.
		const h = mountPicker({ value: '2026-08-01', today: '2026-08-01' });
		const empties = h.target.querySelectorAll('span.cal-day.empty');
		expect(empties.length).toBeGreaterThanOrEqual(6);
		h.cleanup();
	});
});
