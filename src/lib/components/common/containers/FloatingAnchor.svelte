<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getPanelMode } from '$lib/services/conversation/panel-context.svelte';

	/**
	 * FloatingAnchor — a right-edge stack hosting floating action
	 * buttons (OCI Floating Host port, 2026-08-23; dual-mode since
	 * 2026-08-24 — the per-panel anchoring fix): vertical flex column,
	 * right edge, vertically centered. Children render via snippet
	 * (leaf buttons — UserMessagesButton, BackToTheEdgeButton — each
	 * optionally wrapped by a relative div when it owns a popup).
	 *
	 * Geometry contract (OCI Floating Host, pixel-faithful):
	 *   - standalone (no provider): fixed, right-2, bottom 50vh —
	 *     anchored to the viewport (one conversation per page).
	 *   - embedded (a panel on the floor): absolute, right-2,
	 *     bottom 1/2 — anchored to ConversationPanel's `relative`
	 *     root, so N panels each get their own stack at THEIR
	 *     right-middle (the 2026-08-24 bug: every panel's fixed
	 *     stack piled onto the viewport's right-middle).
	 * NO transform (OCI discipline — bottom-anchored, never
	 * top+translate), so rect math stays honest under zoom.
	 *
	 * Pointer events pass through the stack itself (pointer-events-none)
	 * and re-enable on the buttons — the column never blocks transcript
	 * clicks in the gap between buttons.
	 */
	let {
		embedded = getPanelMode(),
		children
	}: { embedded?: boolean; children: Snippet } = $props();
</script>

<div
	class="pointer-events-none z-50 flex flex-col items-center gap-2 {embedded
		? 'absolute bottom-1/2 right-2'
		: 'fixed bottom-[50vh] right-2'}"
	data-testid="floating-anchor"
>
	{@render children()}
</div>
