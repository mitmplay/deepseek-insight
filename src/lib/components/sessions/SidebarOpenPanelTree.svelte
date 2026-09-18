<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { ChevronsDownUp, ChevronsUpDown } from '@lucide/svelte';

	/**
	 * SidebarOpenPanelTree — the header row's lineage fold pair
	 * (extracted from SidebarOpenPanels 2026-09-03): collapse-all /
	 * expand-all over every session that HAS lineage on the floor (a
	 * depth-0 panel with children — the gate the rows' fold chevron
	 * renders under). Purely presentational — the facts arrive as props
	 * and the invocations leave as callbacks; the host owns the fold
	 * map and persists it through its own choke point.
	 *
	 * Disable grammar: a seg at its extreme sits disabled — but only
	 * while the group stands EXPANDED, where the extremes are visible.
	 * A COLLAPSED group renders no rows at all, so neither extreme is
	 * visible truth: both segments stay armed, and a click also asks
	 * the host to expand the group so the fold result shows.
	 */
	let {
		collapsed,
		allFolded,
		allUnfolded,
		oncollapseall,
		onexpandall
	}: {
		/** The host group ships its rows hidden — the segments stay armed. */
		collapsed: boolean;
		/** Every lineage session already ships folded — collapse-all is dead. */
		allFolded: boolean;
		/** Every lineage session stands unfolded — expand-all is dead. */
		allUnfolded: boolean;
		/** Collapse-all invocation — the host flips the fold map, expands
		 *  the group, and persists. */
		oncollapseall: () => void;
		/** Expand-all invocation — the host flips the fold map, expands
		 *  the group, and persists. */
		onexpandall: () => void;
	} = $props();

	/** The disable facts: the fold extremes gate only what is visible —
	 *  a collapsed group arms both segments. */
	const collapseDisabled = $derived(!collapsed && allFolded);
	const expandDisabled = $derived(!collapsed && allUnfolded);
</script>

<!-- ONE joined pill, zero gap, outer curves only (the app's seg-group
     grammar). Sibling of the header's group button, never a child —
     a button cannot nest a button. -->
<div
	class="seg-group"
	role="group"
	aria-label={t(m.lineageFold)}
	data-testid="sidebar-lineage-fold-toggle"
>
	<button
		type="button"
		class="seg left"
		disabled={collapseDisabled}
		aria-label={t(m.collapseLineage)}
		title={t(m.collapseLineage)}
		data-testid="sidebar-lineage-collapse-all"
		onclick={oncollapseall}
	>
		<ChevronsDownUp size={12} aria-hidden="true" />
	</button>
	<button
		type="button"
		class="seg right"
		disabled={expandDisabled}
		aria-label={t(m.expandLineage)}
		title={t(m.expandLineage)}
		data-testid="sidebar-lineage-expand-all"
		onclick={onexpandall}
	>
		<ChevronsUpDown size={12} aria-hidden="true" />
	</button>
</div>

<style>
	/* NewChatButton's seg-group contract copied verbatim (the app's one
	   segmented-toggle language): ONE joined pill, zero gap, shared 1px
	   edges (the right segment drops its left border), outer curves only.
	   Icon-only segments; rest #52606d, hover accent-deep; a seg at its
	   extreme sits at 0.6. */
	.seg-group {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
	}

	.seg {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, #fff);
		background: transparent;
		color: #52606d;
		line-height: 1;
		padding: 0.15rem 0.275rem;
		cursor: pointer;
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease;
	}

	.seg :global(svg) {
		display: block;
	}

	.seg:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.seg.left {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		border-top-left-radius: 9999px;
		border-bottom-left-radius: 9999px;
	}

	.seg.right {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
		border-top-right-radius: 9999px;
		border-bottom-right-radius: 9999px;
		border-left-width: 0;
	}

	.seg:not(:disabled):hover {
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 12%, #fff);
	}

	/* Keyboard focus gets the header's navy ring (WCAG 2.4.7), inside the
	   segment's curve so the pill shape keeps reading as one control. */
	.seg:focus-visible {
		outline: 2px solid #1e3a8a;
		outline-offset: -2px;
	}
</style>
