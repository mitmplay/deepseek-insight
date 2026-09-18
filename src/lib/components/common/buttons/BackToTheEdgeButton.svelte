<script lang="ts">
	import { ArrowDown, ArrowUp, Loader2 } from '@lucide/svelte';

	/**
	 * BackToTheEdgeButton — one FloatingAnchor leaf (OCI scroll button port;
	 * 2026-08-26 dual-mode correction): the transcript's FAR-END jump,
	 * not only back-to-top. OCI's button is a toggle — deep in the
	 * transcript it is ArrowUp "Back to top"; near the top of a long
	 * transcript it flips to ArrowDown "Scroll to bottom" (the live
	 * end). The 2026-08-23 port shipped only the top half, so after
	 * scrolling up to read history there was no floating affordance
	 * back to the bottom — the one moment OCI designed it for.
	 *
	 * Visibility: only while the transcript actually overflows its
	 * viewport by more than `threshold` px — a fitting transcript has
	 * no far end to jump to. Mode: scrollTop past the same threshold =
	 * top mode, else bottom mode. Both recompute on every scroll event;
	 * the listener is owned by an $effect — unmount detaches it.
	 *
	 * The page's stick-to-bottom guard reacts to the same scroll events:
	 * scrolling up disengages the auto-follow; the bottom click's smooth
	 * scroll lands inside the stick window and re-engages it, so this
	 * button and a streaming turn never fight over the viewport. The up
	 * click no longer WAITS for that scroll-event release: it reports
	 * onleavebottom first (2026-09-08) and the owner flips the
	 * StickToBottomToggle OFF before the viewport moves — deterministic,
	 * not first-paint-late.
	 *
	 * Tone CSS follows UserMessagesButton's leaf-button pattern
	 * (2026-08-27): structure in .floating-anchor-btn, color in
	 * .tone-blue — a translucent 12% tint with a 1px tone border and a
	 * blue glyph at rest, hover lighting the glyph to text-primary, and
	 * .draining as the saturated moment (the tone-cyan .active recipe:
	 * solid fill, white glyph). Scoped style, var + fallback — Tailwind
	 * opacity utilities on theme tokens silently no-op when the token is
	 * absent; a scoped style block cannot.
	 *
	 * Shift+click top jump (2026-08-26): a plain "Back to top" reaches
	 * only the top of the LOADED window — the sentinel then auto-loads
	 * one older page and the prepend anchor keeps the viewport put, so
	 * a long conversation costs one click per page. Shift+click drains
	 * EVERY remaining older page first (the panel's loadAllOlder), then
	 * lands at the true head in one action. The title discloses the
	 * modifier; the button disables while the drain runs.
	 */
	let {
		container,
		threshold = 200,
		onloadall,
		onleavebottom
	}: {
		/** Transcript scroll container (the page's <main>). */
		container: HTMLElement | undefined;
		/** Scroll distance (px): gates visibility and separates the two modes. */
		threshold?: number;
		/** Drain every older page before the top jump — Shift+click (top mode). */
		onloadall?: () => Promise<void>;
		/** Report an up jump (top mode) BEFORE the viewport moves — the
		 *  owner releases the stick pin first (2026-09-08): the
		 *  StickToBottomToggle goes OFF deterministically, so a streaming
		 *  mutation cannot yank the smooth scroll back to the live end. */
		onleavebottom?: () => void;
	} = $props();

	/** True while the transcript overflows its viewport past the threshold. */
	let overflowed = $state(false);
	/** True when the viewport sits past the threshold — top mode. */
	let deep = $state(false);

	function refresh(): void {
		if (container === undefined) {
			overflowed = false;
			deep = false;
			return;
		}
		overflowed = container.scrollHeight - container.clientHeight > threshold;
		deep = container.scrollTop > threshold;
	}

	$effect(() => {
		// CAPTURE the element for the teardown: `container` is a reactive
		// destructured prop, and bind:this assigns null on unmount BEFORE
		// effects destroy — a teardown reading the prop then crashes
		// ("Cannot read properties of null (reading 'removeEventListener')",
		// observed on panel close 2026-08-24). The captured local is the
		// exact element the listener attached to, whatever the prop does.
		const el = container;
		if (!el) return;
		refresh();
		el.addEventListener('scroll', refresh);
		return () => el.removeEventListener('scroll', refresh);
	});

	/** True while a Shift-drain runs — the button waits it out. */
	let draining = $state(false);

	async function jump(e: MouseEvent): Promise<void> {
		if (!container) return;
		// An up jump releases the stick FIRST (2026-09-08): the toggle-off
		// lands before the Shift-drain and before the viewport moves. The
		// scroll-event release below only fires as the smooth scroll
		// paints — a streaming append in that gap would yank the jump back
		// to the live end. Releasing never scrolls (OFF just stops
		// following), so the release itself cannot fight this jump.
		if (deep) onleavebottom?.();
		// Shift+click (top mode): drain every hidden older page first,
		// THEN land at the true head — the whole point of the modifier.
		if (e.shiftKey && deep && onloadall && !draining) {
			draining = true;
			try {
				await onloadall();
			} finally {
				draining = false;
			}
			container.scrollTo({ top: 0, behavior: 'smooth' });
			return;
		}
		container.scrollTo({
			top: deep ? 0 : container.scrollHeight,
			behavior: 'smooth'
		});
	}
</script>

{#if overflowed}
	<button
		type="button"
		class="floating-anchor-btn tone-blue"
		class:draining
		disabled={draining}
		title={deep ? 'Back to top — Shift+click loads all history' : 'Scroll to bottom'}
		aria-label={deep ? 'Back to top — Shift+click loads all history' : 'Scroll to bottom'}
		data-testid={deep ? 'back-to-top' : 'scroll-to-bottom'}
		onclick={jump}
	>
		{#if draining}<Loader2 size={18} class="spin" />{:else if deep}<ArrowUp size={18} />{:else}<ArrowDown size={18} />{/if}
	</button>
{/if}

<style>
	.floating-anchor-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 9999px;
		cursor: pointer;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		transition: background 0.15s, color 0.15s, transform 0.1s;
		pointer-events: auto;
	}

	.floating-anchor-btn:hover {
		transform: scale(1.08);
	}

	/* Blue tone — far-edge jump (UserMessagesButton tone parity) */
	.tone-blue {
		border: 1px solid var(--color-accent-blue, #3b82f6);
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 12%, transparent);
		color: var(--color-accent-blue, #3b82f6);
	}

	.tone-blue:hover {
		color: var(--color-text-primary, #fff);
	}

	/* Drain state (Shift+click): the tone's saturated moment — the
	   tone-cyan .active recipe. Source order keeps it above :hover, so
	   the spinner stays white under the cursor while pages load; the
	   disabled attribute blocks a second drain mid-flight. Reduced
	   motion freezes the spin (WCAG 2.3.3). */
	.tone-blue.draining {
		background: var(--color-accent-blue, #3b82f6);
		color: white;
		border-color: var(--color-accent-blue, #3b82f6);
		cursor: wait;
	}

	/* Icon inherits button color */
	.floating-anchor-btn :global(svg) {
		color: inherit;
	}

	.floating-anchor-btn :global(.spin) {
		animation: bte-rotate 1s linear infinite;
	}

	@keyframes bte-rotate {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.floating-anchor-btn :global(.spin) {
			animation: none;
		}
	}
</style>
