<script lang="ts">
	/**
	 * LensLoupeComposerBody — test fixture: mounts PanelLoupe with a
	 * panel composer inside the children snippet (the route's D7 shape) —
	 * the sync check must initialize inside the lens tree and read
	 * disabled even though the DOM portals to document.body.
	 */
	import PanelLoupe from '$lib/components/panels/PanelLoupe.svelte';
	import PromptInput from '$lib/components/chat/PromptInput.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const SID = '9f0c1a2b-3d4e-4f5a-6b7c-8d9e0a1b2c3d';
</script>

<PanelLoupe panelId="p1" sessionId={SID} {onclose}>
	<PromptInput onsubmit={() => true} oncancel={() => {}} isStreaming={false} sending={false} sessionId={SID} />
</PanelLoupe>
