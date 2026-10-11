<script lang="ts">
	/**
	 * Root layout — the one place global styles enter the app.
	 *
	 * Wave 4.1 finding: no root layout existed, so `src/app.css`
	 * (`@import 'tailwindcss'`) was never imported — every Tailwind class in
	 * every component was dead markup. Surfaced by the Playwright dots test:
	 * the indicator's dots had `h-1.5 w-1.5` sizes only via Tailwind, rendered
	 * 0×0, and Playwright correctly reported the span `hidden`.
	 */
	import '../app.css';
	import { onMount } from 'svelte';
	import { themePrefs } from '$lib/utils/theme-prefs.svelte';

	let { children } = $props();

	// The Three-State Lamp (ADR-0023 D2/D3): the pre-paint script in
	// app.html already resolved and set html[data-theme] - the store ADOPTS
	// it here and attaches the live OS listener. Never re-sets at boot.
	onMount(() => themePrefs.adopt());
</script>

{@render children()}
