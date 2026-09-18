<script lang="ts">
	/**
	 * LensProbe — test fixture (the EmbeddedAnchorHost precedent): reads
	 * the lens flag ONCE at init — the same read point as the four
	 * floor-verb controls — and renders it as `data-lens` for assertions.
	 */
	import { getLensMode } from '$lib/services/conversation/lens-context.svelte';

	const lens = getLensMode();
</script>

<span data-testid="lens-probe" data-lens={String(lens)}></span>
