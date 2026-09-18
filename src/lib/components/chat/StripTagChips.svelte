<script lang="ts">
	/**
	 * StripTagChips — the strip's recommended-tag checkbox chips (The
	 * Prompt Tags ADR, 2026-09-14, D10): rendered AFTER SuggestLine, at
	 * the bottom of the strip where the eye finishes. Presentational —
	 * recTags and checked arrive as props; toggles report the word up
	 * (the strip owns the desk-slot persistence and the local filter).
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	let {
		recTags,
		checked,
		ontoggle
	}: {
		recTags: string[];
		checked: string[];
		ontoggle: (word: string) => void;
	} = $props();
</script>

{#if recTags.length > 0}
	<div class="strip-tag-chips" role="group" aria-label={t(m.filterByTags)}>
		{#each recTags as word (word)}
			<label class="strip-tag-chip" class:on={checked.includes(word)}>
				<input
					type="checkbox"
					checked={checked.includes(word)}
					onchange={() => ontoggle(word)}
				/>
				{word}
			</label>
		{/each}
	</div>
{/if}

<style>
	.strip-tag-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.375rem 0.625rem;
		border-top: 1px solid rgba(139, 92, 246, 0.12);
	}
	.strip-tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.625rem;
		background: var(--color-surface, #f8f9fa);
		color: var(--color-text-secondary, #495057);
		font-size: 0.6875rem;
		line-height: 1.25rem;
		padding: 0 0.5rem;
		cursor: pointer;
	}
	.strip-tag-chip.on {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 14%, transparent);
		border-color: var(--color-accent-blue, #3b82f6);
		color: var(--color-accent-blue, #3b82f6);
		font-weight: 600;
	}
	.strip-tag-chip input {
		accent-color: var(--color-accent-blue, #3b82f6);
		margin: 0;
	}
</style>
