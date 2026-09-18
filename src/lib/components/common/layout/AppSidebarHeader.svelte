<script lang="ts">
	/**
	 * AppSidebarHeader — the expanded rail header (extracted from
	 * AppSidebar, 2026-09): the About prefix, the brand title, and the
	 * right-hand action cluster, composed from AboutButton,
	 * AppSidebarHeaderTitle, and AppSidebarHeaderAction. Owns the
	 * animated gradient surface for the expanded state (the collapsed
	 * stub keeps its copy in AppSidebar — Svelte styles are
	 * component-scoped, so the shared rule had to be split; keep the two
	 * gradients in sync).
	 *
	 * Presentational only — collapse flipping stays delegated upward.
	 */
	import AppSidebarHeaderTitle from './AppSidebarHeaderTitle.svelte';
	import AppSidebarHeaderAction from './AppSidebarHeaderAction.svelte';
	import AboutButton from './AboutButton.svelte';

	let {
		captureContainer = null,
		onToggleCollapse
	}: {
		/** The ConversationPage root element — passed through to the
		 *  canvas-copy button's capture target (page-owned bind:this). */
		captureContainer?: HTMLElement | null;
		/** Flip collapsed ↔ expanded (page-owned, persisted there). */
		onToggleCollapse?: () => void;
	} = $props();
</script>

<header class="rail-header">
	<!-- Prefix: the circled-A About trigger leads the header row. -->
	<AboutButton />
	<AppSidebarHeaderTitle />
	<AppSidebarHeaderAction {captureContainer} {onToggleCollapse} />
</header>

<style>
	.rail-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.375rem;
		padding: 0.5rem 0.5rem;
		border-radius: 0.25rem;
		border: solid thin #ffa9003d;
	}

	/* Animated gradient surface — the expanded-header half of what was one
	   shared rule with the collapsed stub (.rail-collapsed) in AppSidebar.
	   Svelte styles are component-scoped, so the rule split across the two
	   components; the gradient is oversized (300% x 300%) and the animation
	   pans background-position. Stops are richer pastels (warm peach → sky
	   blue → lilac → mint), each WCAG-AA-checked against the #4b5563 label
	   text (>= 5.4:1 contrast). Keep in sync with AppSidebar's stub copy. */
	.rail-header {
		--rail-gradient: linear-gradient(
			120deg,
			#ffe9d6,
			#c7ddf8,
			#e4d5f7,
			#c3f0dc,
			#ffe9d6
		);
		background: var(--rail-gradient);
		background-size: 300% 300%;
		animation: rail-header-gradient 12s ease-in-out infinite;
	}

	@keyframes rail-header-gradient {
		0% {
			background-position: 0% 50%;
		}
		50% {
			background-position: 100% 50%;
		}
		100% {
			background-position: 0% 50%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rail-header {
			animation: none;
		}
	}
</style>
