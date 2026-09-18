<script lang="ts">
	/**
	 * LensHost — test fixture: the PanelLoupe provider shape — sets the
	 * lens flag at init, then renders the probe that reads it back.
	 */
	import { setLensMode } from '$lib/services/conversation/lens-context.svelte';
	import LensProbe from './LensProbe.svelte';

	let { lens = true }: { lens?: boolean } = $props();

	// Intentional initial capture: context exists only during component
	// initialisation — the fixture mirrors PanelLoupe, which sets the
	// flag once at init before rendering children.
	// svelte-ignore state_referenced_locally
	setLensMode(lens);
</script>

<LensProbe />
