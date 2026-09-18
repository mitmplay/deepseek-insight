<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * TurnErrorChip — a turn that died without a reply (2026-08-22, dead-turn
	 * bug). Wire truth: turn/end reason.kind === 'error' (e.g. MISSING_CREDENTIAL
	 * — no API key for the selected provider route). The chip is the honest
	 * surface: prompt accepted, turn ran, LLM never answered. Red skin always
	 * (a failed turn is never neutral); the popup carries the verbatim wire
	 * message + code. OCI ChipButton pattern: page owns the expanded state.
	 */
	import { ChevronDown, ChevronRight } from '@lucide/svelte';

	interface Props {
		message: string;
		code?: string;
		/** Popup split: expanded state is OWNED BY THE PAGE (OCI pattern). */
		open?: boolean;
		ontoggle?: () => void;
	}

	let { message, code, open = false, ontoggle }: Props = $props();
</script>

<div class="self-start text-xs" data-testid="turn-error-chip">
	<button
		type="button"
		onclick={() => ontoggle?.()}
		aria-expanded={open}
		data-testid="turn-error-toggle"
		class="chip-button inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-mono font-medium
				mx-0.5 my-0.5 align-middle shrink-0 transition-colors select-none cursor-pointer
				bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
	>
		{#if open}
			<ChevronDown size={10} />
		{:else}
			<ChevronRight size={10} />
		{/if}
		<span class="text-[10px]">{t(m.turnFailed)}{code !== undefined ? ` · ${code}` : ''}</span>
		<span aria-hidden="true" data-testid="turn-error-dot" class="w-1.5 h-1.5 shrink-0 rounded-full bg-red-500"></span>
	</button>
</div>

<style>
	.chip-button :global(svg) {
		color: var(--color-red-600);
	}
</style>
