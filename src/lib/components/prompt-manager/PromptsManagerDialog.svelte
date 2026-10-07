<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * PromptsManagerDialog — modal CRUD over the prompts library (ADR E4;
	 * ported from OCI's PromptsManager.svelte, Suggest Strip Wave 3).
	 *
	 * SHELL ONLY since 2026-09-06: the backdrop, the centered modal frame,
	 * and the close gestures — the content (toolbar, tables, edit dialog,
	 * and all CRUD state) lives in PromptManagerPanel. Callbacks pass
	 * straight through: onclose (user dismisses), onchanged (CRUD
	 * happened — host refreshes nothing eagerly; the strip refetches on
	 * the next trigger).
	 *
	 * Portal contract (BC-7): the whole modal mounts in a host div that
	 * Composer portals to document.body — the panel floor's CSS zoom
	 * becomes the containing block for position:fixed, so any fixed UI
	 * rendered inside the scaled panel canvas is trapped (ADR: "fixed UI
	 * escapes the zoom trap"). The host renders this component inside a
	 * {#if} — onclose unmounts it.
	 */
	import PromptManagerPanel from '../prompt-manager/PromptManagerPanel.svelte';
	import PromptsManagerDialogHeader from '../prompt-manager/PromptsManagerDialogHeader.svelte';

	let {
		onclose,
		onchanged
	}: {
		onclose: () => void;
		onchanged?: () => void;
	} = $props();
</script>

<!-- Backdrop -->
<div
	class="mgr-backdrop"
	role="presentation"
	onclick={onclose}
	onkeydown={(e) => {
		if (e.key === 'Escape') onclose();
	}}
></div>

<!-- Modal -->
<div class="mgr-modal" role="dialog" aria-label={t(m.manageSavedPrompts)} tabindex="-1">
	<PromptsManagerDialogHeader {onclose} />
	<div class="mgr-dialog-body">
		<PromptManagerPanel {onclose} {onchanged} />
	</div>
</div>

<style>
	/* Layer family (all fixed, all above the strip's floating layers):
	   backdrop 10003 < modal 10004 < edit backdrop 10005 < edit dialog
	   10006 (the panel's own layers). The strip's ⋯ menu popup (10001)
	   and StripTip preview (10002) stay below — the manager the operator
	   explicitly opened covers the strip's transient popups, never the
	   reverse. */
	.mgr-backdrop {
		position: fixed;
		inset: 0;
		z-index: 10003;
		background: rgba(0, 0, 0, 0.4);
	}

	.mgr-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		/* DSI portal host (BC-7): the host div is a direct child of
		   document.body, so translate(-50%, -50%) centers on the viewport
		   with no transform-ancestor to fight (OCI needed the workaround
		   because its manager rendered inside a transformed tree). */
		transform: translate(-50%, -50%);
		z-index: 10004;
		width: 90%;
		max-width: 60rem;
		/* Stable floor (bugfix 2026-09-10): max-height alone let the modal
		   collapse to the filtered content — a search/select filter dropping
		   the list below ~10 rows shrank the dialog to a sliver, and the
		   edit flow became too tiny to reach Save without scrolling. The
		   floor matches the full-density state (sticky header + head row +
		   ~10 body rows) and yields on short viewports. */
		min-height: min(28rem, 80vh);
		max-height: 95vh;
		display: flex;
		flex-direction: column;
		background: var(--color-surface-elevated, #fff);
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.5rem;
	}

	/* The scrolling sibling: owns the overflow so the header stays put. */
	.mgr-dialog-body {
		flex: 1;
		min-height: 0; /* allow shrink inside the flex column */
		overflow-y: auto;
	}

</style>
