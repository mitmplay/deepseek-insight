<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * StreamingIndicator — three bouncing dots (OCI Composer port,
	 * 2026-08-24). Presentational: title in, dots out.
	 *
	 * Default anchor is the OCI textarea overlay, DSI-tuned: absolute
	 * against the host's RELATIVE wrapper — right edge, vertically
	 * centered on the host's ACTION BUTTON (bottom-anchored at half the
	 * button height, so the dots stay put when the textarea auto-grows;
	 * the row is items-end, wrapper bottom = button bottom). Streaming
	 * red, pointer-events none. `center` switches to inline flow for
	 * hosts that place the dots in the transcript themselves (e.g. the
	 * snippet-passing fixture).
	 *
	 * Contract pins (chat-components tests): the testid element carries
	 * role=status + aria-label and holds EXACTLY the three dot spans —
	 * no wrapper element.
	 */
	let {
		title = 'streaming',
		center = false
	}: {
		title?: string;
		center?: boolean;
	} = $props();
</script>

<span
	class="streaming-indicator"
	class:centered={center}
	role="status"
	aria-label={t(m.streaming)}
	data-testid="streaming-indicator"
	{title}
>
	<span class="dot dot-1"></span>
	<span class="dot dot-2"></span>
	<span class="dot dot-3"></span>
</span>

<style>
	/* Anchor: absolute against the host's relative wrapper — right edge
	   (0.25rem), vertically centered on the action button. Bottom-anchored
	   at half the button height (px-4 py-2 text-sm = 2rem → 1rem, measured
	   32px in-browser) with translateY(50%): the dots' midline sits exactly
	   at the button's midline and stays there when the textarea auto-grows
	   (items-end row keeps the wrapper's bottom on the button's bottom). */
	.streaming-indicator {
		position: absolute;
		bottom: 1rem;
		right: 0.25rem;
		transform: translateY(50%);
		display: flex;
		align-items: center;
		gap: 4px;
		color: #ef4444;
		pointer-events: none;
	}
	/* Inline-flow variant: the host owns the placement. */
	.streaming-indicator.centered {
		position: static;
		bottom: auto;
		right: auto;
		transform: none;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor; /* root color: streaming red */
		animation: dot-bounce 1.4s ease-in-out infinite;
	}
	.dot-2 {
		animation-delay: 0.2s;
	}
	.dot-3 {
		animation-delay: 0.4s;
	}
	@keyframes dot-bounce {
		0%,
		80%,
		100% {
			opacity: 0.2;
			transform: scale(0.7);
		}
		40% {
			opacity: 1;
			transform: scale(1.2);
		}
	}
</style>
