<script lang="ts">
	/**
	 * Agents — the agent pill group of SessionFilterRow (extracted
	 * 2026-08-24): Bot/purple pills A–Z, one per preset the HOST offers
	 * (agentPreset.list), session-count badged — count 0 for agents with
	 * no sessions yet. Labels are the host's display names (DSH picker
	 * parity: `cordis` shows as `Creator mode`; unlisted presets fall
	 * back to the id), so the testid anchors to the stable key, never
	 * the mutable label (workspaces may key by label — their labels ARE
	 * stable path basenames). The pills are dual-purpose (2026-08-24):
	 * they filter the list AND arm + New chat with the selected agent,
	 * so an available-but-unused agent must render selectable. Purely
	 * presentational — the option list arrives derived (session-filters),
	 * the filter state lives in SessionFilterRow; a pick reports the key
	 * upward and the owner toggles the dimension.
	 */
	import { Bot } from '@lucide/svelte';
	import type { FilterOption } from '$lib/utils/session-filters';

	let {
		presets,
		selected,
		onpick
	}: {
		presets: FilterOption[];
		/** Active preset id, null = none. */
		selected: string | null;
		/** Report a pill pick — the owner toggles (same pill untoggles). */
		onpick: (key: string) => void;
	} = $props();
</script>

{#if presets.length > 0}
	{#each presets as p (p.key)}
		<button
			type="button"
			class="pill preset reg"
			class:on={selected === p.key}
			onclick={() => onpick(p.key)}
			aria-pressed={selected === p.key}
			title={`agent preset — ${p.key}`}
			data-testid="filter-preset-{p.key}"
		>
			<Bot size={12} aria-hidden="true" />
			<span class="label">{p.label}</span><span class="count">{p.count}</span>
		</button>
	{/each}
{/if}

<style>
	/* Restyled 2026-08-26 for the row's accent-wash field (same grammar
	   as SessionFilterRow's pills): rest #52606d (5.52:1), hover
	   accent-deep (5.17:1), selected accent-deep fill + white (5.17:1
	   — the raw token managed 3.68:1 at this 10px size). */
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, #fff);
		border-radius: 9999px;
		background: transparent;
		color: #52606d;
		font-size: 0.625rem;
		line-height: 1;
		padding: 0.25rem 0.5rem;
		cursor: pointer;
		max-width: 9rem;
		white-space: nowrap;
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease;
	}

	.pill:hover {
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 12%, #fff);
	}

	.pill.on {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 65%, #1e3a8a);
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 65%, #1e3a8a);
		color: #fff;
	}

	/* Pill status styles use :not(.on) guards on every REST/HOVER rule
	   (2026-08-23 hover bug): a hover rule at higher specificity than the
	   selected rule once overrode the selected pill's white text with its
	   accent color ON its accent background — same fg as bg. Guards make
	   rest and selected rule sets disjoint; cascade order can no longer
	   regress either state. */

	/* Preset pills: every preset is a real pickable identity — purple at
	   rest (chip parity: Bot/purple in the rows), solid purple selected.
	   Purple DEEPENED 2026-08-26 for AA on the wash: rest text is the
	   token mixed 50% toward violet-900 (5.25:1 on its 8% tint, 5.00:1
	   on the hover tint); the selected fill is 75% toward violet-900
	   (white 5.34:1 — the raw #8b5cf6 never cleared 4.5). */
	.pill.preset.reg:not(.on) {
		color: color-mix(in srgb, var(--color-accent-purple, #8b5cf6) 50%, #4c1d95);
		border-color: color-mix(in srgb, var(--color-accent-purple, #8b5cf6) 50%, #4c1d95);
		background: color-mix(in srgb, var(--color-accent-purple, #8b5cf6) 8%, transparent);
	}

	.pill.preset.reg:not(.on):hover {
		color: color-mix(in srgb, var(--color-accent-purple, #8b5cf6) 50%, #4c1d95);
		border-color: color-mix(in srgb, var(--color-accent-purple, #8b5cf6) 50%, #4c1d95);
		background: color-mix(in srgb, var(--color-accent-purple, #8b5cf6) 12%, #fff);
	}

	.pill.preset.on {
		background: color-mix(in srgb, var(--color-accent-purple, #8b5cf6) 75%, #4c1d95);
		border-color: color-mix(in srgb, var(--color-accent-purple, #8b5cf6) 75%, #4c1d95);
		color: #fff;
	}

	/* Icon and count NEVER shrink — only the label ellipsizes (2026-08-23
	   geometry audit: a crushed-to-0px icon on the longest pill). */
	.pill :global(svg) {
		flex-shrink: 0;
	}

	/* Selected pill (app.css icon standard exception): the icon follows
	   the on-state text color — white on the saturated surface — so the
	   global purple default never paints it into its own background. At
	   rest the global purple applies (the pill's icon identity). */
	.pill.on :global(svg) {
		color: inherit;
	}

	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.count {
		flex-shrink: 0;
		font-size: 0.5625rem;
		/* No opacity fade (2026-08-26): at 9px this is TEXT — 0.7 white
		   on the deep purple measured under 4.5:1. Full white: 5.34:1. */
		font-variant-numeric: tabular-nums;
	}
</style>
