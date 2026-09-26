<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * ImageLightbox — document-level original-image preview (DSH
	 * ui-attachment ImageLightbox parity, 2026-08-28): opened by clicking
	 * an attachment thumbnail; closes on Escape, the close control, or a
	 * press on the mask (any click outside the image); focus moves to the
	 * close control on open and returns to the opener on close.
	 *
	 * The root is portaled to document.body: the panel floor's
	 * PanelsZoom row carries a transform: scale() zoom, and a fixed
	 * backdrop inside a transformed ancestor is trapped in that
	 * ancestor's box instead of covering the viewport (the same reason
	 * DSH renders its lightbox through a body portal).
	 */
	let {
		src,
		alt,
		onclose
	}: {
		/** The original image URL. */
		src: string;
		/** The image's alt text. */
		alt: string;
		/** Dismiss callback — the opener owns the open/closed state. */
		onclose: () => void;
	} = $props();

	/** The close control — focus target when the lightbox opens. */
	let closeButton = $state<HTMLButtonElement | null>(null);

	/** Portal the mounted root to document.body (action). */
	function portal(node: HTMLElement): { destroy(): void } {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	$effect(() => {
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		closeButton?.focus();
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') onclose();
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			opener?.focus();
		};
	});
</script>

<div
	use:portal
	class="fixed inset-0 z-[1000] grid place-items-center p-10"
	role="dialog"
	aria-modal="true"
	aria-label={t(m.originalImagePreview)}
	data-testid="attachment-lightbox"
>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions --
		The mask is the "click outside closes" surface; keyboard users close
		through Escape and the close control (DSH's mask is the same shape). -->
	<div
		class="absolute inset-0 bg-black/60"
		aria-hidden="true"
		onmousedown={onclose}
		data-testid="attachment-lightbox-mask"
	></div>
	<img
		{src}
		{alt}
		class="relative max-h-[calc(100vh-80px)] max-w-[min(100%,1600px)] rounded-xl bg-white object-contain shadow-2xl"
		data-testid="attachment-lightbox-image"
	/>
	<button
		type="button"
		bind:this={closeButton}
		onclick={onclose}
		aria-label={t(m.closePreview)}
		data-testid="attachment-lightbox-close"
		class="fixed top-5 right-5 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-lg leading-none text-slate-700 hover:bg-slate-100"
	>×</button>
</div>
