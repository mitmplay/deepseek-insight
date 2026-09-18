<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * SliderZoom — the tray's floor-zoom control (Panel Floor W5 task
	 * 5.1). Range 25..125% step 5; the bound `zoom` prop (route-owned,
	 * `$bindable`) carries every thumb move live into PanelsZoom — the
	 * zoom-frame re-measures per move and no phantom scrollbar appears
	 * at any zoom (that contract is e2e spec 13's).
	 *
	 * Clamps: the slider's min/max mirror panel-prefs' bounds (the single
	 * bound site), and the route's `$effect` persistence runs every value
	 * through `clampPanelZoom` on load — commitment 3 stays one-site.
	 */
	import { PANEL_DEFAULT_ZOOM } from '$lib/utils/panel-prefs';
	import { appConfig } from '$lib/services/config/app-config.svelte';

	let {
		zoom = $bindable(PANEL_DEFAULT_ZOOM)
	}: {
		/** Floor zoom multiplier, default 0.25..1.25 (bind: up to the route). */
		zoom?: number;
	} = $props();

	/** Config-tunable bounds (panel.minZoom/maxZoom) — same source the
	 *  single clamp site reads; reactive if config lands late. */
	const bounds = $derived(appConfig().panel);
</script>

<label class="slider-zoom" data-testid="controlbar-slider-zoom">
	<span class="caption"
		>{t(m.zoom)} <span class="pct" data-testid="controlbar-slider-zoom-value"
			>{Math.round(zoom * 100)}%</span
		></span
	>
	<input
		type="range"
		min={bounds.minZoom}
		max={bounds.maxZoom}
		step={0.001}
		bind:value={zoom}
		data-testid="controlbar-slider-zoom-input"
		aria-label={t(m.floorZoom)}
	/>
</label>

<style>
	.slider-zoom {
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

	.pct {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-primary, #212529);
	}

	.slider-zoom input {
		width: 100%;
		accent-color: var(--color-accent-blue, #3b82f6);
	}

	.slider-zoom input:focus-visible {
		outline: 2px solid var(--color-accent-blue, #3b82f6);
		outline-offset: 2px;
	}
</style>
