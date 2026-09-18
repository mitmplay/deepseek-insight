<!--
	RawPreviewToggle — flip between rendered markdown and the raw source
	(OCI port, 2026-08-22). Bindable showRaw; the host owns the <pre> swap,
	this owns the eye/code icon pair. stopPropagation keeps the click inside
	hover-revealed rows from bubbling into parent handlers.
-->
<script lang="ts">
	import { Eye, Code2 } from '@lucide/svelte';

	let {
		showRaw = $bindable(false),
		ontoggle,
		titlePreview = 'Preview (rendered)',
		titleRaw = 'Raw markdown',
		size = 12
	}: {
		showRaw: boolean;
		ontoggle?: () => void;
		titlePreview?: string;
		titleRaw?: string;
		size?: number;
	} = $props();
</script>

<button
	type="button"
	class="p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover"
	title={showRaw ? titlePreview : titleRaw}
	data-testid="raw-toggle-button"
	onclick={(e) => {
		e.stopPropagation();
		showRaw = !showRaw;
		ontoggle?.();
	}}
>
	{#if showRaw}
		<Eye {size} />
	{:else}
		<Code2 {size} />
	{/if}
</button>
