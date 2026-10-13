<!--
	ToolPeekButton — peek-prefix chip before a chip row (OCI port, 2026-08-22).

	Wrench icon + count of chips in the row. Clicking toggles a ChipPopup
	(page-owned) that lists every chip in one glance — status dot + name +
	args preview — so picking WHICH chip to open is a read, not a hunt.
	Active skin mirrors ContextInjection/ToolCallChip expanded accent.
-->
<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { Wrench, BookOpen } from '@lucide/svelte';

	let {
		count,
		active = false,
		icon = 'wrench',
		onclick
	}: {
		count: number;
		active?: boolean;
		/** 'wrench' — the work-row default; 'context' — an escape strip
		 *  row (ADR-0022 I3): attached context, not work, so the count
		 *  reads with a different glyph at a glance. */
		icon?: 'wrench' | 'context';
		onclick?: (e: MouseEvent) => void;
	} = $props();
</script>

<button
	type="button"
	{onclick}
	title={t(m.peekToolCalls)}
	data-testid="tool-peek-button"
	data-active={active}
	aria-expanded={active}
	class="chip-button inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-mono font-medium
		mx-0.5 my-0.5 align-middle shrink-0 transition-colors select-none cursor-pointer
		{active
			? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
			: 'bg-surface-alt text-text-secondary border border-surface-border hover:bg-surface-hover hover:text-text-primary'}"
>
	{#if icon === 'context'}
		<BookOpen size={10} />
	{:else}
		<Wrench size={10} />
	{/if}
	<span class="text-[10px]">{count}</span>
</button>

<style>
	.chip-button :global(svg) {
		color: var(--color-accent-purple);
	}
</style>
