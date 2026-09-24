<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * ChipPopup — detail container for an expanded chip, rendered AFTER the
	 * chip row (OCI ChipPopup pattern, 2026-08-22): in-flow below the row,
	 * never inside it — expanding a chip never pushes same-row chips.
	 * Status-tinted border optional (tool chips).
	 *
	 * The root IS the scroller (overflow-y-auto under the height cap).
	 * `scroller` (2026-08-26) binds that element out to hosts whose popup
	 * content streams — the think body attaches the shared stick-to-bottom
	 * behavior to it. Optional and unbound by default: the popup stays a
	 * dumb container for everyone else.
	 */
	let {
		border = 'border-surface-border',
		/** Vertical cap for the popup's scroll box. Default = OCI chip height
		 * (max-h-80); file views pass a taller cap — ONE scroller stays owner. */
		maxHeight = 'max-h-80',
		/** Bindable root element (the scroll box) — see the header. */
		scroller = $bindable(),
		children
	}: {
		border?: string;
		maxHeight?: string;
		/** HTMLElement | null: bindable element refs start null before mount. */
		scroller?: HTMLElement | null;
		children: Snippet;
	} = $props();
</script>

<div
	bind:this={scroller}
	class="chip-popup mx-auto mt-1 w-full max-w-full min-w-0 rounded-lg border shadow-lg {maxHeight} overflow-y-auto bg-surface-elevated {border}"
	data-testid="chip-popup"
>
	{@render children()}
</div>
