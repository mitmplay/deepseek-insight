<script lang="ts">
	/**
	 * ClearIconButton — the native input[type=search] cancel look as a
	 * reusable button (extracted from PromptManagerSearch 2026-09-22):
	 * a muted disc with a surface-colored x, drawn inline SVG so it
	 * themes with the surface tokens and renders identically in every
	 * browser (the real cancel button is WebKit-only and unstylable).
	 *
	 * Presentational: the CALLER decides visibility ({#if}) and what
	 * clearing means; the button reports the click and re-focuses
	 * `target` when given (cleared, not dismissed — typing continues).
	 *
	 * Positioning: absolute, bottom-right — the nearest positioned
	 * ancestor owns the placement context (and any padding reserve).
	 */
	let {
		/** Click handler — the caller's clear logic. */
		onclick,
		/** Accessible name / tooltip (i18n'd by the caller). */
		label,
		/** Disc size in px. */
		size = 12,
		/** Element to re-focus after clearing (the field itself). */
		target
	}: {
		onclick: () => void;
		label: string;
		size?: number;
		target?: HTMLElement | null;
	} = $props();

	function click() {
		onclick();
		target?.focus();
	}
</script>

<button type="button" class="clear-icon-btn" aria-label={label} title={label} onclick={click}>
	<svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true">
		<circle cx="6" cy="6" r="6" fill="currentColor" />
		<path
			d="M4 4 L8 8 M8 4 L4 8"
			stroke="var(--color-surface, #f8f9fa)"
			stroke-width="1.4"
			stroke-linecap="round"
		/>
	</svg>
</button>

<style>
	.clear-icon-btn {
		position: absolute;
		right: 0.25rem;
		bottom: 0.25rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		line-height: 1;
		color: var(--color-text-muted, #adb5bd); /* the disc fill */
	}
	.clear-icon-btn:hover {
		color: var(--color-text-primary, #495057); /* disc darkens, x stays surface */
	}
	.clear-icon-btn:focus-visible {
		outline: 1px solid var(--color-accent, #7048e8);
		outline-offset: 1px;
		border-radius: 50%;
	}
</style>
