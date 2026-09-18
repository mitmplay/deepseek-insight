<script lang="ts">
	/**
	 * ControlBarHarness — test fixture (panels-row.test.ts, W5 task
	 * 5.1-T): wraps ControlBar with $state-backed props, an exported
	 * `set()`, and exported getters for the bound values (bind: needs a
	 * writable target the test can read after the tray drives it).
	 * resizeall calls record what the tray committed (order-proof).
	 */
	import ControlBar from '../../src/lib/components/panels/control-bar/ControlBar.svelte';

	let {
		panelWidth = 730,
		zoom = 1
	}: {
		panelWidth?: number;
		zoom?: number;
	} = $props();

	// Intentional initial capture: mount-time values seed the bridge
	// state; later changes arrive only through set() (test driver).
	// svelte-ignore state_referenced_locally
	let w = $state(panelWidth);
	// svelte-ignore state_referenced_locally
	let z = $state(zoom);

	const resizeCalls: number[] = [];

	export function set(next: { panelWidth?: number; zoom?: number }): void {
		if (next.panelWidth !== undefined) w = next.panelWidth;
		if (next.zoom !== undefined) z = next.zoom;
	}

	export function read(): { panelWidth: number; zoom: number } {
		return { panelWidth: w, zoom: z };
	}

	export function resizeLog(): number[] {
		return resizeCalls;
	}
</script>

<ControlBar bind:panelWidth={w} bind:zoom={z} onresizeall={(width) => resizeCalls.push(width)} />
