<!--
	TurnProcessDisclosure — the fold line of The Fold Gate (ADR-0010, 2026-09-09).
	Purely presentational: counts and open state arrive as props, the toggle
	leaves as a callback. The label mirrors DSH's TurnProcessNodeView families
	("N tool calls · M messages · K subagents") with catalog copy
	(paraglide placeholders + the reactive t seat); all-zero counts render the "thought for a while"
	fallback. The caller decides whether to render it at all — a component
	that is not mounted draws nothing.
-->
<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';

	let {
		toolCallCount,
		messageCount,
		subagentCount,
		open,
		ontoggle
	}: {
		toolCallCount: number;
		messageCount: number;
		subagentCount: number;
		open: boolean;
		ontoggle: () => void;
	} = $props();

	const label = $derived.by(() => {
		const parts: string[] = [];
		if (toolCallCount > 0)
			parts.push(
				toolCallCount === 1
					? t(m.toolCallOne)
					: t(() => m.toolCallMany({ n: toolCallCount }))
			);
		if (messageCount > 0)
			parts.push(
				messageCount === 1 ? t(m.messageOne) : t(() => m.messageMany({ n: messageCount }))
			);
		if (subagentCount > 0)
			parts.push(
				subagentCount === 1
					? t(m.subagentOne)
					: t(() => m.subagentMany({ n: subagentCount }))
			);
		return parts.length > 0 ? parts.join(' · ') : t(m.thoughtForAWhile);
	});
</script>

<button
	type="button"
	data-testid="turn-process-disclosure"
	aria-expanded={open}
	title={open ? t(m.hideTurnWork) : t(m.showTurnWork)}
	class="chip-button inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-mono font-medium
			mx-0.5 my-0.5 align-middle shrink-0 transition-colors select-none cursor-pointer
			text-[#7c3aed] bg-[#7c3aed]/10 border border-[#7c3aed]/30 hover:bg-[#7c3aed]/20"
	onclick={() => ontoggle()}
>
	<ChevronRight
		size={10}
		class="shrink-0 transition-transform {open ? 'rotate-90' : ''}"
		aria-hidden="true"
	/>
	<span data-testid="turn-process-label" class="text-[10px]">{label}</span>
</button>
