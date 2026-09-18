<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * ResizeGutter — the 6px draggable seam after every panel (Panel Floor
	 * W3 task 3.2, ADR-0006 R8; OCI port, every-panel-has-a-right-gutter
	 * rule — with individual resize (2026-08-28) each gutter owns its
	 * OWN panel's width, so the rule now just means no panel is the
	 * only one without a seam).
	 *
	 * The gutter does not resize anything itself — mousedown reports
	 * (event, index) upward through the panel registry (the ONLY
	 * leaf→root action channel, commitment 2), and the workspace route
	 * (the single drag owner) snapshots widths and runs the individual /
	 * proportional math on window mousemove.
	 *
	 * The Explorer Layout (ADR 2026-09-17 D4): an OPTIONAL onDragStart
	 * owner prop — when given, the mousedown fires IT instead of the
	 * registry import and the calling component is the drag owner (the
	 * gutter instance lives inside one component, so no leaf→root hop is
	 * needed). When absent, the floor path above runs verbatim — every
	 * existing call site is untouched.
	 */
	let {
		index,
		onDragStart
	}: {
		index: number;
		/** Local drag owner hook — fires INSTEAD of the registry when given. */
		onDragStart?: (event: MouseEvent) => void;
	} = $props();
</script>

<!-- A real button (a11y): the gutter is an interactive separator; drag
     reports (event, index) up through the panel registry — the route owns
     the drag math. Button styling resets to the 6px seam. -->
<button
	type="button"
	class="gutter"
	data-testid="panel-gutter-{index}"
	aria-label={t(m.resizePanel)}
	title={t(m.dragResize)}
	onmousedown={(e) => {
		e.preventDefault();
		if (onDragStart) {
			onDragStart(e);
			return;
		}
		void import('$lib/services/panels/panel-registry').then((reg) =>
			reg.startPanelResize(e, index)
		);
	}}
></button>

<style>
	.gutter {
		display: block;
		padding: 0;
		border: none;
		flex: 0 0 6px;
		width: 6px;
		align-self: stretch;
		cursor: col-resize;
		background: transparent;
		transition: background-color 0.15s ease;
	}

	.gutter:hover,
	.gutter:active {
		background: var(--color-accent-blue, #3b82f6);
	}

	.gutter:focus-visible {
		outline: 2px solid var(--color-accent-blue, #3b82f6);
		outline-offset: -2px;
	}
</style>
