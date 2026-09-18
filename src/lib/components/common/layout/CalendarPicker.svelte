<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * CalendarPicker — the date grid behind the spine's FilterDateButton
	 * (ported from OCI's component, 2026-09-04, on DSI's token grammar):
	 * month nav, a filled selected day, a tinted "today" label, and a dot
	 * on every day that holds at least one session (the caller's date
	 * set). Purely presentational — value in, onchange out; picking the
	 * selected day toggles it off (''), the footer's Clear filter and the
	 * badge's × do the same through the parent.
	 */
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { sessionActivityDate } from '$lib/utils/session-filters';

	let {
		value = '',
		dates,
		today = '',
		onchange,
		onclose
	}: {
		/** Selected date (YYYY-MM-DD) or '' when unfiltered. */
		value?: string;
		/** Days holding at least one session — the dot set. */
		dates?: Set<string>;
		/** Today (YYYY-MM-DD) — the tinted label; '' = the real today. */
		today?: string;
		/** A day was picked (or toggled off / cleared): the next value. */
		onchange?: (date: string) => void;
		/** The picker requests to close (Escape / Clear filter). */
		onclose?: () => void;
	} = $props();

	let viewYear = $state(0);
	let viewMonth = $state(0);

	$effect(() => {
		const init = value || today;
		if (init) {
			const [y, m] = init.split('-').map(Number);
			viewYear = y;
			viewMonth = m - 1;
		} else {
			const d = new Date();
			viewYear = d.getFullYear();
			viewMonth = d.getMonth();
		}
	});

	function pad(n: number): string {
		return String(n).padStart(2, '0');
	}
	function dateStr(y: number, m: number, d: number): string {
		return `${y}-${pad(m)}-${pad(d)}`;
	}

	function monthLabel(): string {
		return new Date(viewYear, viewMonth).toLocaleDateString([], { month: 'long', year: 'numeric' });
	}

	function prevMonth(): void {
		if (viewMonth === 0) {
			viewMonth = 11;
			viewYear--;
		} else viewMonth--;
	}
	function nextMonth(): void {
		if (viewMonth === 11) {
			viewMonth = 0;
			viewYear++;
		} else viewMonth++;
	}

	function selectDate(d: string): void {
		if (onchange) onchange(d === value ? '' : d);
	}
	function clearDate(): void {
		if (onchange) onchange('');
	}
	function close(): void {
		onclose?.();
	}

	function calendarGrid(): (string | null)[][] {
		const firstDay = new Date(viewYear, viewMonth, 1).getDay();
		const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
		const cells: (string | null)[] = [];
		for (let i = 0; i < firstDay; i++) cells.push(null);
		for (let d = 1; d <= daysInMonth; d++) cells.push(dateStr(viewYear, viewMonth + 1, d));
		while (cells.length % 7 !== 0) cells.push(null);
		const rows: (string | null)[][] = [];
		for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
		return rows;
	}

	const days = $derived(calendarGrid());
	const todayLabel = $derived(today || sessionActivityDate(Date.now()));

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') close();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="cal"
	role="dialog"
	aria-label={t(m.datePicker)}
	tabindex="-1"
	onclick={(e) => e.stopPropagation()}
	onkeydown={handleKeydown}
>
	<!-- Header: month nav -->
	<div class="cal-head">
		<button type="button" class="cal-nav" aria-label={t(m.previousMonth)} onclick={prevMonth}>
			<ChevronLeft size={12} aria-hidden="true" />
		</button>
		<span class="cal-month">{monthLabel()}</span>
		<button type="button" class="cal-nav" aria-label={t(m.nextMonth)} onclick={nextMonth}>
			<ChevronRight size={12} aria-hidden="true" />
		</button>
	</div>

	<!-- Day headers -->
	<div class="cal-row cal-days">
		{#each [m.weekdaySu, m.weekdayMo, m.weekdayTu, m.weekdayWe, m.weekdayTh, m.weekdayFr, m.weekdaySa] as day (day)}
			<span class="cal-day-head">{t(day)}</span>
		{/each}
	</div>

	<!-- Day grid -->
	{#each days as row, ri (ri)}
		<div class="cal-row">
			{#each row as date, ci (ci)}
				{#if date}
					<button
						type="button"
						class="cal-day"
						class:selected={date === value}
						class:today={date === todayLabel && date !== value}
						onclick={() => selectDate(date)}
					>
						{date.slice(8, 10)}
						{#if dates?.has(date) && date !== value}
							<span class="cal-dot" aria-hidden="true"></span>
						{/if}
					</button>
				{:else}
					<span class="cal-day empty"></span>
				{/if}
			{/each}
		</div>
	{/each}

	<!-- Clear button -->
	{#if value}
		<div class="cal-foot">
			<button type="button" class="cal-clear" onclick={clearDate}>{t(m.clearFilter)}</button>
		</div>
	{/if}
</div>

<style>
	/* The dropdown card: anchored under the badge's right edge, above the
	   rows (the header is pinned, so no scroll container clips it). */
	.cal {
		position: absolute;
		right: 0;
		top: 100%;
		margin-top: 0.25rem;
		z-index: 50;
		width: 14rem;
		padding: 0.5rem;
		background: var(--color-surface-elevated, #fff);
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.5rem;
		box-shadow: 0 0.5rem 1rem rgb(0 0 0 / 0.15);
		user-select: none;
	}

	.cal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 0.25rem;
		margin-bottom: 0.25rem;
	}

	.cal-nav {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-secondary, #6c757d);
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease;
	}

	.cal-nav:hover {
		background: var(--color-surface-hover, #e9ecef);
		color: var(--color-text-primary, #212529);
	}

	.cal-month {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-text-primary, #212529);
	}

	.cal-row {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		text-align: center;
	}

	.cal-days {
		margin-bottom: 0.125rem;
	}

	.cal-day-head {
		font-size: 0.5625rem;
		font-weight: 600;
		padding: 0.125rem 0;
		color: var(--color-text-secondary, #6c757d);
	}

	.cal-day {
		position: relative;
		width: 1.75rem;
		height: 1.75rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		font-size: 0.625rem;
		color: var(--color-text-secondary, #6c757d);
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.cal-day:hover {
		background: var(--color-surface-hover, #e9ecef);
	}

	.cal-day.empty {
		background: transparent;
		cursor: default;
	}

	.cal-day.selected {
		background: var(--color-accent-purple, #8b5cf6);
		color: #fff;
		font-weight: 600;
	}

	.cal-day.today {
		color: var(--color-accent-purple, #8b5cf6);
		font-weight: 600;
	}

	.cal-dot {
		position: absolute;
		bottom: 0.125rem;
		left: 50%;
		transform: translateX(-50%);
		width: 0.25rem;
		height: 0.25rem;
		border-radius: 9999px;
		background: var(--color-accent-purple, #8b5cf6);
	}

	.cal-foot {
		display: flex;
		justify-content: center;
		margin-top: 0.25rem;
		padding-top: 0.25rem;
		border-top: 1px solid color-mix(in srgb, var(--color-surface-border, #dee2e6) 30%, transparent);
	}

	.cal-clear {
		border: none;
		background: transparent;
		padding: 0.125rem 0.5rem;
		font-size: 0.625rem;
		color: var(--color-text-secondary, #6c757d);
		cursor: pointer;
		transition: color 0.15s ease;
	}

	.cal-clear:hover {
		color: var(--color-text-primary, #212529);
	}
</style>
