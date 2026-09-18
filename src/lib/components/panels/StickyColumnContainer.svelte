<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * StickyColumnContainer — a fixed-width LEADING column inside the zoom
	 * row (OCI StickyColumnContainer port, 2026-08-26; hosts the embedded
	 * AppSidebar the way OCI's hosts ControlRail).
	 *
	 * "Sticky" = the width is TRIPLE-LOCKED (width/min/max all the same
	 * px), unlike panel columns whose widths live in [MIN, MAX]: the rail
	 * never flexes when the row measures itself at max-content. The
	 * column's background paints the full column height — the rail inside
	 * fills it (align-items: stretch).
	 *
	 * The trailing ResizeGutter is included BY DEFAULT (OCI parity) but
	 * only when panel columns actually follow (showGutter) — a rail alone
	 * on the floor has nothing to resize against. The gutter is the
	 * column's flex SIBLING (the rail's overflow must never clip its hit
	 * area) and reports mousedown through onResizeStart — the page owns
	 * the drag math and the single clamp (AppSidebar ownership split;
	 * ControlBar.onresizeall precedent: layout chrome is a DIRECT child
	 * of the route, so prop wiring here breaks no commitment).
	 */
	import type { Snippet } from 'svelte';

	let {
		width,
		showGutter = true,
		onResizeStart,
		children
	}: {
		/** Sticky (fixed) column width in px — triple-locked, never flexes. */
		width: number;
		/** Trailing resize gutter — only when panel columns follow (OCI). */
		showGutter?: boolean;
		/** Gutter mousedown — the page runs the drag and owns the clamp. */
		onResizeStart?: (e: MouseEvent) => void;
		children: Snippet;
	} = $props();
</script>

<div
	class="rail-column"
	data-testid="sidebar-column"
	style="width: {width}px; min-width: {width}px; max-width: {width}px;"
>
	{@render children()}
</div>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions — mouse-drag
     resize handle (OCI ResizeGutter / AppSidebar gutter pattern);
     keyboard-driven resize is a known gap, not a silent omission -->
{#if showGutter}
	<div
		class="rail-gutter"
		data-testid="sidebar-gutter"
		role="separator"
		aria-orientation="vertical"
		aria-label={t(m.resizeSidebar)}
		onmousedown={(e) => onResizeStart?.(e)}
	></div>
{/if}

<style>
	/* Column-geometry essentials (OCI StickyColumnContainer .rail-column):
	   the triple-locked width arrives INLINE (width/min/max); this rule
	   carries the flex-column shell + the surface paint. */
	.rail-column {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		background: var(--color-surface-elevated, #fff);
		position: relative;
		overflow: visible;
	}

	/* Resize gutter — 6px column right of the locked column (same seam
	   as AppSidebar's own gutter in the out-of-zoom placement: one
	   visual contract, two host sites). */
	.rail-gutter {
		width: 6px;
		flex-shrink: 0;
		cursor: col-resize;
		transition: background-color 0.15s ease;
	}

	.rail-gutter:hover {
		background: var(--color-accent-blue, #3b82f6);
		opacity: 0.25;
	}
</style>
