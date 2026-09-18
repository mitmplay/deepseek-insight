<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * AboutDialog — the app's about box, opened from the sidebar footer's
	 * circled-A trigger. One centered frame: the app title (h1), the
	 * one-line pitch (h2), the credit line, and the author link.
	 *
	 * Shell grammar copied from PromptsManagerDialog: fixed backdrop +
	 * centered modal, and the host (SidebarFooter) portals the mount to
	 * document.body — the panel floor's CSS zoom becomes the containing
	 * block for position:fixed, so any fixed UI rendered inside the
	 * scaled sidebar canvas is trapped (BC-7). The frame carries the
	 * rail header's animated gradient surface (AppSidebar .rail-header,
	 * the one shared pastel pan). Dismiss: backdrop click, the × close,
	 * or Escape (one window listener, unmounts with the {#if} — no
	 * stale key handler).
	 */
	let { onclose }: { onclose: () => void } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<!-- Backdrop -->
<div class="about-backdrop" role="presentation" onclick={onclose}></div>

<!-- Modal -->
<div class="about-modal" role="dialog" aria-label={t(m.aboutDsi)} tabindex="-1">
	<button
		type="button"
		class="about-close"
		data-testid="about-close"
		aria-label={t(m.closeAbout)}
		title={t(m.close)}
		onclick={onclose}
	>
		×
	</button>
	<!-- i18n-skip: brand, never translated -->
	<h1 class="about-title" data-testid="about-title">DEEPSEEK INSIGHT</h1>
	<h2 class="about-subtitle" data-testid="about-subtitle">{t(m.aboutTagline)}</h2>
	<p class="about-credit" data-testid="about-credit">
		{t(m.aboutCredit)}
	</p>
	<a
		class="about-link"
		data-testid="about-link"
		href="https://www.linkedin.com/in/wharsojo/"
		target="_blank"
		rel="noopener noreferrer"
	>
		https://www.linkedin.com/in/wharsojo/
	</a>
</div>

<style>
	/* Layer family: about-backdrop 10007 < about-modal 10008 — a distinct
	   pair above the strip/manager family (10001-10006), so the two
	   dialogs never fight for the same layer if both are ever open. */
	.about-backdrop {
		position: fixed;
		inset: 0;
		z-index: 10007;
		background: rgba(0, 0, 0, 0.4);
	}

	.about-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 10008;
		width: 90%;
		max-width: 24rem;
		padding: 1.25rem 1.5rem 1.5rem 1.5rem;
		text-align: center;
		/* The rail header's animated gradient surface (AppSidebar
		   .rail-header grammar): the pastel gradient is oversized
		   (300% x 300%) and panned by background-position — gradients
		   can't transition directly, the animation is the transition.
		   Stops are AA-checked against the #4b5563 secondary inks below. */
		--about-gradient: linear-gradient(
			120deg,
			#ffe9d6,
			#c7ddf8,
			#e4d5f7,
			#c3f0dc,
			#ffe9d6
		);
		background: var(--about-gradient);
		background-size: 300% 300%;
		animation: about-gradient-pan 12s ease-in-out infinite;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.5rem;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
	}

	@keyframes about-gradient-pan {
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
		.about-modal {
			animation: none;
		}
	}

	.about-close {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		font-size: 0.875rem;
		line-height: 1;
		color: var(--color-text-secondary, #6c757d);
		background: transparent;
		border-radius: 0.25rem;
		cursor: pointer;
	}

	.about-close:hover {
		color: var(--color-text-primary, #212529);
		background: var(--color-surface-hover, rgb(0 0 0 / 0.05));
	}

	.about-title {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--color-text-primary, #212529);
	}

	.about-subtitle {
		margin: 0.5rem 0 0 0;
		font-size: 0.8125rem;
		font-weight: 500;
		/* The rail title's ink — AA (>= 5.4:1) on every gradient stop. */
		color: #4b5563;
	}

	.about-credit {
		margin: 1rem 0 0 0;
		font-size: 0.75rem;
		/* The rail title's ink — AA (>= 5.4:1) on every gradient stop. */
		color: #4b5563;
	}

	.about-link {
		display: inline-block;
		margin-top: 0.375rem;
		font-size: 0.75rem;
		/* The new-chat button's deepened blue ink — readable on pastels
		   where the raw accent blue is not. */
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		text-decoration: none;
	}

	.about-link:hover {
		text-decoration: underline;
	}
</style>
