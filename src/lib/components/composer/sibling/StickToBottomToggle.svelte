<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { ArrowDownToLine } from '@lucide/svelte';

	/**
	 * StickToBottomToggle — the composer's stick-to-bottom indicator and
	 * switch (2026-08-26): maroon while the transcript follows the live
	 * bottom, grey once the reader scrolled away — click flips it. Sits
	 * directly above the submit button (Composer's send column).
	 *
	 * Icon: ArrowDownToLine (user-picked, 2026-08-26) — the lucide set
	 * pinned here (1.0.1) has no layers-arrow-down; the arrow-onto-a-line
	 * glyph reads as "pinned to the bottom" and matches the scroll
	 * button's arrow grammar.
	 *
	 * The STATE is not owned here: stick arrives as a prop (bound through
	 * ConversationPanel to ConversationScrollArea's scroll-stick flag) and
	 * a flip reports upward — the panel re-engages by scrolling to the
	 * live end, so the button never lies about what follow means. Scroll
	 * events keep the prop honest on both directions: scrolling up breaks
	 * stick (button greys), returning to the bottom re-engages it.
	 *
	 * Maroon #800000 (8.4:1 on white) active / grey rest — color AND the
	 * pressed state carry the meaning, never color alone.
	 */
	let {
		stick,
		ontoggle
	}: {
		/** Live stick-to-bottom state (scroll-driven, bindable upstream). */
		stick: boolean;
		/** Report a manual flip — the owner decides the side effects. */
		ontoggle: (next: boolean) => void;
	} = $props();

	const title = $derived(
		stick
			? 'Stick to bottom: on — new output follows the live end (click to release)'
			: 'Stick to bottom: off — the transcript stays where you scrolled (click to follow the live end)'
	);
</script>

<button
	type="button"
	class="stick-toggle"
	class:on={stick}
	onclick={() => ontoggle(!stick)}
	aria-pressed={stick}
	aria-label={t(m.stickToBottom)}
	{title}
	data-testid="stick-toggle"
	data-active={stick}
>
	<ArrowDownToLine size={14} aria-hidden="true" />
</button>

<style>
	/* Small utility toggle (1.5rem — visibly subordinate to the 2rem
	   send button below it). Ghost style: no fill, colored glyph. */
	.stick-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: var(--color-text-secondary, #6c757d);
		cursor: pointer;
		padding: 0;
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease;
	}

	.stick-toggle:hover {
		border-color: color-mix(in srgb, #800000 40%, transparent);
		color: #800000;
	}

	/* Maroon while following the live bottom (user spec, 2026-08-26):
	   #800000 reads 8.4:1 on white — the ON state stays legible. */
	.stick-toggle.on {
		color: #800000;
		border-color: color-mix(in srgb, #800000 45%, transparent);
		background: color-mix(in srgb, #800000 8%, transparent);
	}

	/* State-semantic icon (app.css icon standard exception): the glyph
	   carries the toggle's maroon/grey state — color inherit, never the
	   global purple default. */
	.stick-toggle :global(svg) {
		flex-shrink: 0;
		color: inherit;
	}
</style>
