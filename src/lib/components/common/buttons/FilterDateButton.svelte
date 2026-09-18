<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * FilterDateButton — the spine's date filter badge with a calendar
	 * picker (ported from OCI's component, 2026-09-04, on DSI's token
	 * grammar). Shows `filter` when inactive, `MM-DD ×` when active; the
	 * × clears, the badge toggles the calendar, and click-outside /
	 * Escape close it. Presentational: the picked date reports upward
	 * through onchange ('' = cleared) — persistence and the row filtering
	 * are the owner's (SidebarSessions, via spine-group-prefs).
	 */
	import { CalendarDays, X } from '@lucide/svelte';
	import CalendarPicker from '$lib/components/common/layout/CalendarPicker.svelte';

	let {
		value = '',
		dates,
		today = '',
		onchange,
		onclose
	}: {
		/** Selected date (YYYY-MM-DD) or '' when unfiltered. */
		value?: string;
		/** Days holding at least one session — the calendar's dot set. */
		dates?: Set<string>;
		/** Today (YYYY-MM-DD); '' = the real today. */
		today?: string;
		/** A day was picked, toggled off, or cleared: the next value. */
		onchange?: (date: string) => void;
		/** The picker requested to close (Escape / Clear filter). */
		onclose?: () => void;
	} = $props();

	let showCalendar = $state(false);
	let calendarContainer: HTMLDivElement | undefined = $state();

	// ── Calendar click-outside / escape ──
	function handleClickOutside(e: MouseEvent): void {
		if (!calendarContainer) return;
		const target = e.target;
		// Guard: synthetic events may have non-Element targets (e.g. Document)
		if (!(target instanceof Element)) return;
		if (!calendarContainer.contains(target) && !target.closest('[data-calendar-trigger]')) {
			showCalendar = false;
		}
	}

	function handleEscape(e: KeyboardEvent): void {
		if (e.key === 'Escape') showCalendar = false;
	}

	$effect(() => {
		showCalendar;
		if (showCalendar) {
			const t = setTimeout(() => {
				document.addEventListener('click', handleClickOutside);
				document.addEventListener('keydown', handleEscape);
			}, 0);
			return () => clearTimeout(t);
		}
		document.removeEventListener('click', handleClickOutside);
		document.removeEventListener('keydown', handleEscape);
	});

	function handleBadgeClick(e: MouseEvent): void {
		if ((e.target as HTMLElement).closest('[data-clear-date]')) return;
		e.stopPropagation();
		showCalendar = !showCalendar;
	}

	function clearDate(e: MouseEvent): void {
		e.stopPropagation();
		if (onchange) onchange('');
		showCalendar = false;
	}
</script>

<div class="wrap" data-calendar-trigger>
	<div class="badge" class:active={value !== ''}>
		<button
			type="button"
			class="trigger"
			onclick={handleBadgeClick}
			title={t(m.filterByDate)}
			aria-label={t(m.filterSessionsByDate)}
			aria-expanded={showCalendar}
		>
			{#if value}
				<span class="label">{value.slice(5)}</span>
			{:else}
				<!-- The inactive affordance is the calendar glyph, not the word
				     `filter` (2026-09-04) — the header row is too tight for a
				     fourth label, and the glyph reads at a glance. -->
				<CalendarDays size={12} aria-hidden="true" />
			{/if}
		</button>
		{#if value}
			<button
				type="button"
				class="clear"
				data-clear-date
				aria-label={t(m.clearDateFilter)}
				title={t(m.clearDateFilter)}
				onclick={clearDate}
			>
				<X size={10} aria-hidden="true" />
			</button>
		{/if}
	</div>
	{#if showCalendar}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="anchor" bind:this={calendarContainer}>
			<CalendarPicker
				{value}
				{dates}
				{today}
				onchange={(onchange ?? (() => {}))}
				onclose={() => (showCalendar = false)}
			/>
		</div>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
		flex-shrink: 0;
	}

	/* The badge chip — the header's control grammar (the filter-input's
	   height and border family, the row-btn's scale). Active = the purple
	   the spine's title carries, so an engaged filter is never a mere
	   glyph swap. */
	.badge {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		height: 1.375rem;
		padding: 0 0.25rem 0 0.375rem;
		border: 1px solid color-mix(in srgb, var(--color-surface-border, #dee2e6) 75%, transparent);
		border-radius: 0.375rem;
		background: var(--color-surface-elevated, #fff);
		font-size: 0.6875rem;
		color: var(--color-text-secondary, #6c757d);
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}

	.badge:hover {
		background: var(--color-surface-hover, #e9ecef);
	}

	.badge.active {
		color: blueviolet;
	}

	.trigger {
		display: inline-flex;
		align-items: center;
		border: none;
		background: transparent;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.trigger:focus-visible {
		outline: 2px solid #1e3a8a;
		outline-offset: 1px;
		border-radius: 0.25rem;
	}

	.label {
		line-height: 1;
		white-space: nowrap;
	}

	/* The × — quiet until hovered, then red (the destructive hue the
	   row-btn grammar reserves for clears). */
	.clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.125rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-secondary, #6c757d);
		cursor: pointer;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}

	.clear:hover {
		color: var(--color-status-fail, #ef4444);
		background: rgb(239 68 68 / 0.1);
	}

	/* The calendar anchors to this (position: relative host). */
	.anchor {
		position: relative;
	}
</style>
