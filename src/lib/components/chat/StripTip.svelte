<script lang="ts">
	/**
	 * StripTip — the multiline full-text preview tooltip of one suggestion
	 * row (OCI's StripMultiline lineage, its own component again).
	 *
	 * Presentational: chip anchor + live flags + raw text in, one portaled
	 * tooltip out. Visible only while its chip is the active (keyboard-
	 * highlighted) row, the row text is multiline, and no ⋯ menu is open
	 * anywhere on the strip (the host threads menuOpen/anyMenuOpen).
	 */
	import { renderMarkdown } from '$lib/utils/markdown.js';

	let {
		/** The chip root element — the tooltip's position anchor; its
		 *  parentElement IS the host .suggest-strip. */
		anchor,
		/** True while this chip is the active (keyboard-highlighted) row. */
		active = false,
		/** True while THIS chip's ⋯ menu is open — hides the tooltip. */
		menuOpen = false,
		/** True while ANY chip's ⋯ menu is open — hides the tooltip. */
		anyMenuOpen = false,
		/** The row's raw text — multiline is the tooltip's reason to exist. */
		text
	}: {
		anchor?: HTMLElement;
		active?: boolean;
		menuOpen?: boolean;
		anyMenuOpen?: boolean;
		text: string;
	} = $props();

	/** Tooltip box; null = hidden. Mirrors the STRIP's horizontal geometry
	 *  — same left edge, same width — regardless of which chip is active;
	 *  y anchors above the whole strip. Hides whenever any ⋯ menu is open. */
	let tipPos = $state<{ x: number; y: number; w: number } | null>(null);
	let tipEl = $state<HTMLDivElement | undefined>();

	/** Markdown render (DSI's shared escape-first util — raw HTML never
	 *  reaches the output; safe for {@html}). Preview tooltip only. */
	const tipHtml = $derived(renderMarkdown(text));

	// While this chip is the active (keyboard-highlighted) row and its
	// text is multiline, anchor the popup above the whole strip. effect.pre: the
	// anchor settles before the popup mounts (no position flash).
	$effect.pre(() => {
		if (!active || menuOpen || anyMenuOpen || !anchor || !text.includes('\n')) {
			tipPos = null;
			return;
		}
		const strip = anchor.parentElement; // direct parent IS .suggest-strip
		if (!strip) return;
		const sr = strip.getBoundingClientRect();
		tipPos = {
			x: Math.max(0, sr.left),
			y: Math.max(8, sr.top - 4),
			w: sr.width
		};
	});

	// Portal the tooltip to document.body (BC-7 — same zoom-transform
	// escape as the ⋯ menu popup).
	$effect(() => {
		if (!tipEl) return;
		const el = tipEl; // capture: bind:this nulls tipEl before cleanup runs
		document.body.appendChild(el);
		return () => {
			el.remove();
		};
	});
</script>

{#if active && text.includes('\n') && !menuOpen && !anyMenuOpen && tipPos}
	<!-- Full-text markdown preview while this multiline chip is the
	     active row: fixed above the strip, strip-aligned, kept
	     content-height with a 70vh cap, portaled to document.body
	     (zoom-transform-safe), never interactive (keyboard stays in
	     the prompt textarea). Typography from the global .md-content
	     rules. -->
	<div
		bind:this={tipEl}
		class="strip-tip"
		role="tooltip"
		style={`left:${tipPos.x}px; top:${tipPos.y}px; width:${tipPos.w}px;`}
	><div class="strip-tip-md md-content">{@html tipHtml}</div></div>
{/if}

<style>
	/* Multiline preview tooltip — fixed to viewport, strip-aligned (left +
	   width set inline from the strip's rect), opening ABOVE the strip.
	   Never interactive: pointer-events none, no focus. Portaled to
	   document.body. */
	.strip-tip {
		position: fixed;
		transform: translateY(-100%);
		z-index: 10002; /* above the ⋯ menu popup (10001) */
		background: var(--color-surface-elevated, #ffffff);
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.375rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		padding: 0.25rem;
		pointer-events: none;
	}

	.strip-tip-md {
		margin: 0;
		font-family: inherit;
		font-size: 0.75rem;
		line-height: 1.4;
		word-break: break-word;
		overflow-y: auto;
		max-height: 70vh;
		padding: 0.25rem 0.375rem;
		color: var(--color-text-primary, #212529);
	}
	/* Tighten markdown block margins inside the small tooltip. */
	.strip-tip-md :global(p:first-child) {
		margin-top: 0;
	}
	.strip-tip-md :global(p:last-child) {
		margin-bottom: 0;
	}
	.strip-tip-md :global(p) {
		margin: 0.25em 0;
	}
	.strip-tip-md :global(ul),
	.strip-tip-md :global(ol) {
		margin: 0.25em 0;
	}
	.strip-tip-md :global(code) {
		font-size: 0.6875rem;
	}
</style>
