<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import AboutDialog from '$lib/components/sessions/AboutDialog.svelte';

	/**
	 * AboutButton — the circled-A About trigger (extracted from
	 * SidebarFooter, 2026-09-12): opening mounts the dialog through a
	 * portal host appended to document.body — the modal's
	 * position:fixed escapes the panel floor's CSS zoom (BC-7, the
	 * PromptsManagerDialog portal contract). Self-contained: trigger,
	 * open state, portal, and dialog travel together.
	 *
	 * Accepts a passthrough `class` so a host can layer its own scoped
	 * ink (e.g. AppSidebar's collapsed stub reuses rail-collapsed-label).
	 */
	// About box (2026-09-07): the circled-A trigger mounts the dialog
	// through a portal host appended to document.body — the modal's
	// position:fixed escapes the panel floor's CSS zoom (BC-7, the
	// PromptsManagerDialog portal contract).
	let { class: passthroughClass = '' }: { class?: string } = $props();

	let aboutOpen = $state(false);
	let aboutPortal = $state<HTMLDivElement | undefined>();

	$effect(() => {
		if (!aboutPortal) return;
		const el = aboutPortal; // capture: bind:this nulls before cleanup runs
		document.body.appendChild(el);
		return () => {
			el.remove();
		};
	});
</script>

<button
	type="button"
	class="about-trigger {passthroughClass}"
	data-testid="sidebar-about-trigger"
	aria-label={t(m.aboutDsi)}
	title={t(m.aboutDsi)}
	onclick={() => (aboutOpen = true)}
>
	A
</button>

{#if aboutOpen}
	<!-- BC-7 portal host: mounted to document.body by the effect above. -->
	<div bind:this={aboutPortal}>
		<AboutDialog onclose={() => (aboutOpen = false)} />
	</div>
{/if}

<style>
	/* About trigger — the header-prefix circled-A (2026-09-07): 18px
	   circle, letter A centered. The old muted gray border vanished
	   against the header's pastel gradient, so the ring is now the rail's
	   accent purple at rest with a soft matching glow — visible on every
	   gradient stop — deepening on hover/focus (AppSidebar .icon-btn
	   purple hover grammar).

	   Catchy loop (2026-09): border + fill slowly cycle through the
	   rail's pastel palette (peach → blue → lilac → mint → purple),
	   echoing the header gradient. Hover/focus override with the deeper
	   purple grammar (animation-fill-mode keeps the keyframes from
	   fighting the transition); reduced-motion users get the static
	   purple ring. */
	.about-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 18px;
		height: 18px;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1;
		color: var(--color-accent-purple, #8b5cf6);
		background: rgb(255 255 255 / 0.55);
		border: 1.5px solid var(--color-accent-purple, #8b5cf6);
		border-radius: 9999px;
		box-shadow: 0 0 0 2px rgb(139 92 246 / 0.18);
		cursor: pointer;
		animation: about-ring-cycle 8s ease-in-out infinite;
		transition:
			color 0.15s ease,
			box-shadow 0.15s ease;
	}

	@keyframes about-ring-cycle {
		0%,
		100% {
			border-color: #8b5cf6;
			background: rgb(255 255 255 / 0.55);
		}
		25% {
			border-color: #f6ad7b;
			background: rgb(255 233 214 / 0.75);
		}
		50% {
			border-color: #60a5fa;
			background: rgb(199 221 248 / 0.75);
		}
		75% {
			border-color: #34d399;
			background: rgb(195 240 220 / 0.75);
		}
	}

	.about-trigger:hover,
	.about-trigger:focus-visible {
		animation: none;
		color: #7c3aed;
		border-color: #7c3aed;
		background: rgb(255 255 255 / 0.85);
		box-shadow: 0 0 0 3px rgb(139 92 246 / 0.35);
		outline: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.about-trigger {
			animation: none;
		}
	}
</style>
