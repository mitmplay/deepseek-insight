<script lang="ts">
	import { setConversationSession } from '$lib/services/conversation/session-context.svelte';
	import FilesEditedCard from '$lib/components/message/cards/FilesEditedCard.svelte';

	// The ConversationPanel shape in miniature: setContext during init,
	// then render the card — the established test-host pattern
	// (floating-anchor.test.ts EmbeddedAnchorHost).
	let { sessionId, turn, seq }: { sessionId?: string; turn: number; seq: number } = $props();
	// Init-capture is intentional: props never change in this test host, and
	// setContext must run during component init (ConversationPanel pattern).
	// svelte-ignore state_referenced_locally
	if (sessionId !== undefined) setConversationSession(sessionId);
</script>

<FilesEditedCard {turn} {seq} />
