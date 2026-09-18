<!--
	CopyButton — copy-to-clipboard icon button with 2s ✓ feedback (OCI port,
	2026-08-22). Presentational: takes a string value, delegates the write
	to copyWithFeedback; onclick prop lets hosts chain extra behavior.
-->
<script lang="ts">
	import { Copy, Check } from '@lucide/svelte';
	import { copyWithFeedback } from '$lib/utils/clipboard';

	let {
		value,
		title = 'Copy',
		size = 12,
		class: className = '',
		onclick
	}: {
		value: string;
		title?: string;
		size?: number;
		class?: string;
		onclick?: (e: MouseEvent) => void;
	} = $props();

	let copied = $state(false);
</script>

<button
	type="button"
	class="{className}"
	{title}
	data-testid="copy-text-button"
	onclick={async (e) => {
		e.stopPropagation();
		if (onclick) onclick(e);
		await copyWithFeedback(value, (v) => (copied = v));
	}}
>
	{#if copied}
		<Check {size} class="text-green-500" />
	{:else}
		<Copy {size} />
	{/if}
</button>
