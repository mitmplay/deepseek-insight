<script lang="ts">
	/**
	 * LensLoupeProbeBody — test fixture: mounts PanelLoupe the way the
	 * route will, with a REAL component inside the children snippet (the
	 * production shape; createRawSnippet cannot carry components). The
	 * probe reads the lens flag at its own init — from PanelLoupe,
	 * through the snippet, after the DOM portals to body.
	 */
	import PanelLoupe from '$lib/components/panels/PanelLoupe.svelte';
	import LensProbe from './LensProbe.svelte';

	let { onclose }: { onclose: () => void } = $props();
</script>

<PanelLoupe panelId="p1" sessionId="s-1" {onclose}>
	<LensProbe />
</PanelLoupe>
