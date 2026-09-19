<script lang="ts">
	/**
	 * AppSidebarHeaderAction — the expanded rail header's right-hand action
	 * cluster (extracted from AppSidebar, 2026-09): add-workspace, locale
	 * switcher, canvas copy, and the collapse button.
	 */
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { PanelLeftClose } from '@lucide/svelte';
	import CanvasCopyButton from '$lib/components/common/buttons/CanvasCopyButton.svelte';

	let {
		captureContainer = null,
		onToggleCollapse
	}: {
		/** The ConversationPage root element — the canvas-copy button's
		 *  capture target (page-owned bind:this). Null before mount (SSR,
		 *  first paint): the button renders regardless, its click is
		 *  CanvasCopyButton's documented null-container no-op. */
		captureContainer?: HTMLElement | null;
		/** Flip collapsed ↔ expanded (page-owned, persisted there). */
		onToggleCollapse?: () => void;
	} = $props();
</script>

<div class="rail-header-actions">
	<CanvasCopyButton
		container={captureContainer}
		mode="visible"
		title={t(m.copyPageImage)}
		size={14}
		class="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded transition-colors hover:bg-surface-hover"
	/>
	<button
		type="button"
		class="icon-btn"
		onclick={() => onToggleCollapse?.()}
		aria-expanded={true}
		aria-label={t(m.collapseSidebar)}
		title={t(m.collapseSidebar)}
	>
		<PanelLeftClose size={14} />
	</button>
</div>

<style>
	.rail-header-actions {
		display: flex;
		align-items: center;
		/*gap: 0.375rem;*/
		flex-shrink: 0;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		border-radius: 0.25rem;
		color: var(--color-text-secondary, #6c757d);
		background: transparent;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}

	.icon-btn:hover,
	.icon-btn:focus-visible {
		color: var(--color-accent-purple, #8b5cf6);
		background: var(--color-surface-hover, rgb(0 0 0 / 0.05));
		outline: none;
	}
</style>
