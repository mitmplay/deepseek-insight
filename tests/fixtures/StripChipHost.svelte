<script lang="ts">
	/**
	 * StripChipHost — test fixture (strip-chip.test.ts): flips the
	 * CONTROLLED menuOpen prop after the chip's ⋯ handler has run, so the
	 * popup renders on the SAME instance that computed its strip-aligned
	 * position (direct-mount props are one-shot; a remount would reset
	 * the chip's internal menuPos state). `inStrip` wraps the chip in a
	 * `.suggest-strip` ancestor for the alignment resolution.
	 */
	import StripChip from '../../src/lib/components/chat/suggest-strip/StripChip.svelte';
	import type { SuggestedPrompt } from '../../src/lib/services/chat/prompt-trigger.js';

	let { row, inStrip = false }: { row: SuggestedPrompt; inStrip?: boolean } = $props();
	let menuOpen = $state(false);
</script>

<div class={inStrip ? 'suggest-strip' : 'bare'}>
	<StripChip
		{row}
		{menuOpen}
		onpick={() => {}}
		onrename={() => {}}
		ondelete={() => {}}
		onclose={() => {}}
		onmenuopen={() => (menuOpen = true)}
		onmenuclose={() => (menuOpen = false)}
	/>
</div>
