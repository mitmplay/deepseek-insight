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
	import { Wrench } from '@lucide/svelte';

	let {
		count,
		active = false,
		onclick
	}: {
		count: number;
		active?: boolean;
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
	<Wrench size={10} />
	<span class="text-[10px]">{count}</span>
</button>

<style>
	.chip-button :global(svg) {
		color: var(--color-accent-purple);
	}
</style>
