<script lang="ts">
	/**
	 * ReasoningSection — the assistant's thinking, collapsed by default
	 * (Wave 2, task 2.3; ADR-0003 "honest inspector": the reasoning is wire
	 * truth, so it is never dropped — it is one click away).
	 *
	 * Chip-only since the popup split (2026-08-22): [chevron] + `think`;
	 * the body renders in a ChipPopup AFTER the chip row (page-owned) —
	 * expanding never pushes same-row chips. Label is plain lowercase
	 * `think` in every state; live streaming is carried by the shared
	 * SessionStatus running glyph beside it (motion = in progress, the
	 * house live-motion pattern) — the text itself never changes. The
	 * glyph is RED app-wide (app.css owns --si-run on :root); the chip
	 * adds no styling of its own.
	 */
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import SessionStatus from '$lib/components/sessions/SessionStatus.svelte';

	let {
		reasoning,
		streaming = false,
		open = false,
		ontoggle
	}: { reasoning: string; streaming?: boolean; open?: boolean; ontoggle?: () => void } = $props();
</script>

{#if reasoning.length > 0}
	<div class="self-start text-xs" data-testid="reasoning-section" data-open={open}>
		<button
			type="button"
			onclick={() => ontoggle?.()}
			aria-expanded={open}
			data-testid="reasoning-toggle"
			aria-label={streaming ? t(m.thinkingLabel) : t(m.thinkLabel)}
			class="chip-button inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-mono font-medium
			mx-0.5 my-0.5 align-middle shrink-0 transition-colors select-none cursor-pointer
			{open
				? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
				: 'bg-surface-alt text-text-secondary border border-surface-border hover:bg-surface-hover hover:text-text-primary'}"
		>
			{#if open}
				<ChevronDown size={10} />
			{:else}
				<ChevronRight size={10} />
			{/if}
			<span class="text-[10px]">{t(m.thinkLabel)}</span>
			{#if streaming}<SessionStatus running={true} />{/if}
		</button>
	</div>
{/if}

<style>
	.chip-button :global(svg) {
		color: var(--color-accent-purple);
	}
</style>
