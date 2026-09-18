<script lang="ts">
	/**
	 * WorkspaceChip — the ONE workspace chip identity (extracted
	 * 2026-09-06 from three copy-paste twins): Folder icon + basename
	 * label in a pill, blue-deepened-toward-navy when the workspace is
	 * registered, grey when ghost (the cwd is gone from the host
	 * workspace registry). Before this component the same colors were
	 * hand-copied in WorkspaceRowItem (.ws), DisplayWorkspace
	 * (.ws-chip), and SessionFilterHeader (.chip.ws); now this file is
	 * the single home and the hosts own only what differs.
	 *
	 * GEOMETRY CONTRACT — CSS custom properties, overridable per host
	 * through an inherited `style` or a host rule (they cascade into
	 * this element): --wsc-width (default auto), --wsc-max-width
	 * (6.5rem), --wsc-font-size (0.75rem), --wsc-padding (0.15rem
	 * 0.375rem), --wsc-gap (0.1875rem). COLOR CONTRACT — --wsc-fg /
	 * --wsc-border / --wsc-bg override the identity colors for hosts
	 * with their own states (the Workspaces pill's selected fill sets
	 * all three; hover-only hosts leave them alone).
	 *
	 * AA rests (WCAG relative luminance, calibrated 2026-08-26):
	 * registered text/border mix 50% accent-blue toward navy — 4.94:1
	 * on white at 9px, 4.75:1 on its 8% tint; ghost #52606d — 6.22:1
	 * white spine, 5.52:1 on the row wash, 4.95:1 on the selected
	 * field.
	 *
	 * The icon NEVER shrinks and inherits the chip's text color (the
	 * kind grammar: icon = dimension color) — only the label
	 * ellipsizes (.chip-label). The e2e chipLabel locator pins that
	 * inner class; keep it.
	 */
	import { Folder } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	let {
		label,
		ghost = false,
		iconSize = 10,
		testid,
		title,
		// No default: the template's `cls ?? ''` guard is the single fallback
		// (a default here made that fallback a dead branch).
		class: cls,
		trailing,
		children,
		...rest
	}: {
		/** Chip text — the pill derivation's basename (workspaceLabel). */
		label: string;
		/** Ghost truth: cwd absent from the host workspace registry. */
		ghost?: boolean;
		/** Folder glyph size in px (hosts pick their row scale). */
		iconSize?: number;
		/** Test id on the chip root; hosts pin their own. */
		testid?: string;
		/** Chip tooltip — hosts own the grammar (full path + suffixes). */
		title?: string;
		/** Extra root classes (e.g. the filter header's `menuable`). */
		class?: string;
		/** Trailing slot inside the pill (the Workspaces count badge). */
		trailing?: Snippet;
		/** Default slot — same seat as `trailing`, caller's pick. */
		children?: Snippet;
		/** Spread onto the root span (style, role, onclick, data-*). */
		[key: string]: unknown;
	} = $props();
</script>

<span
	class="ws-chip {cls}"
	class:ghost
	data-testid={testid}
	{title}
	{...rest}
>
	<Folder size={iconSize} aria-hidden="true" />
	<span class="chip-label">{label}</span>
	{#if trailing}{@render trailing()}{/if}
	{#if children}{@render children()}{/if}
</span>

<style>
	.ws-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--wsc-gap, 0.1875rem);
		flex-shrink: 0;
		width: var(--wsc-width, auto);
		max-width: var(--wsc-max-width, 6.5rem);
		border-radius: 9999px;
		font-size: var(--wsc-font-size, 0.75rem);
		line-height: 1;
		padding: var(--wsc-padding, 0.15rem 0.375rem);
		vertical-align: middle;
		white-space: nowrap;
		/* Registered identity: blue deepened 50% toward navy — text,
		   border, and an 8% tint field. */
		border: 1px solid
			var(--wsc-border, color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a));
		background: var(--wsc-bg, color-mix(in srgb, var(--color-accent-blue, #3b82f6) 8%, transparent));
		color: var(--wsc-fg, color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a));
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease;
	}

	.ws-chip :global(svg) {
		flex-shrink: 0;
		color: inherit;
	}

	/* Ghost identity (hybrid truth): grey, never blue — the sessions
	   used a workspace the host registry no longer lists. Translucent
	   field lets the host surface's own tint through. */
	.ws-chip.ghost {
		border-color: var(
			--wsc-border,
			color-mix(in srgb, #52606d 45%, transparent)
		);
		background: var(
			--wsc-bg,
			var(--si-chip-ghost-bg, color-mix(in srgb, var(--color-surface-alt, #f1f3f5) 35%, transparent))
		);
		color: var(--wsc-fg, var(--si-chip-ghost, #52606d));
	}

	.chip-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
