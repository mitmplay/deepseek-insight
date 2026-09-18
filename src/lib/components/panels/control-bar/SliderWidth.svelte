<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * SliderWidth — the tray's uniform-width control (Panel Floor W5
	 * task 5.1). One range input 480..860 (the panel-prefs bounds — the
	 * slider's min/max mirror the ONLY clamp site's constants, and every
	 * commit routes through `clampPanelWidth` in the route's
	 * `onresizeall` handler, keeping commitment 3 intact).
	 *
	 * Realtime (2026-08-27): every thumb move fires `onresizeall(width)`
	 * on `input` — the panels resize LIVE under the dragging thumb, the
	 * same per-move cadence as SliderZoom's bound zoom (the old
	 * commit-on-`change` release lag is gone). The route sets every
	 * panel to that width AND the preset — the honest-slider contract's
	 * "slider sets all panels" direction.
	 */
	import { PANEL_DEFAULT_WIDTH } from '$lib/utils/panel-prefs';
	import { appConfig } from '$lib/services/config/app-config.svelte';

	let {
		value = $bindable(PANEL_DEFAULT_WIDTH),
		onresizeall
	}: {
		/** Bound width preset (config bounds, default 480..860). */
		value?: number;
		/** Commit: apply this width to all panels (route-owned). */
		onresizeall: (width: number) => void;
	} = $props();

	/** Config-tunable bounds (panel.minWidth/maxWidth) — same source the
	 *  single clamp site reads; reactive if config lands late. */
	const bounds = $derived(appConfig().panel);
</script>

<label class="slider-width" data-testid="controlbar-slider-width">
	<span class="caption">{t(m.width)} <span class="px" data-testid="controlbar-slider-width-value">{value}px</span></span>
	<input
		type="range"
		min={bounds.minWidth}
		max={bounds.maxWidth}
		step={1}
		bind:value
		oninput={() => onresizeall(value)}
		data-testid="controlbar-slider-width-input"
		aria-label={t(m.panelWidthAll)}
	/>
</label>

<style>
	.slider-width {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.6875rem;
		color: var(--color-text-secondary, #6c757d);
	}

	.caption {
		display: flex;
		justify-content: space-between;
	}

	.px {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-primary, #212529);
	}

	.slider-width input {
		width: 100%;
		accent-color: var(--color-accent-blue, #3b82f6);
	}

	.slider-width input:focus-visible {
		outline: 2px solid var(--color-accent-blue, #3b82f6);
		outline-offset: 2px;
	}
</style>
