<!--
	Test fixture (task 2.2-T): mounts PromptBubble with a StreamingIndicator
	child the way the conversation page does — snippet passing through a real
	client component (createRawSnippet is server-only; this is the supported
	client path). Not shipped code. User-side only since the two-group
	adoption (OCI pattern, 2026-08-21) — assistant streaming rides
	AssistantTurn now.
-->
<script lang="ts">
	import PromptBubble from '$lib/components/message/PromptBubble.svelte';
	import StreamingIndicator from '$lib/components/chat/StreamingIndicator.svelte';

	let { text = 'thinking…', time }: { text?: string; time?: number } = $props();
</script>

<PromptBubble {text} {time}>
	<StreamingIndicator center />
</PromptBubble>
