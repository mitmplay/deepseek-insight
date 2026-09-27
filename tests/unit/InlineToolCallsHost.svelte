<script lang="ts">
	import { setConversationSession } from '$lib/services/conversation/session-context.svelte';
	import InlineToolCalls from '$lib/components/message/assistant/InlineToolCalls.svelte';
	import type { TurnMember } from '$lib/utils/turn-grouping';

	// The ConversationPanel shape in miniature: context set during init,
	// then the transcript row — the established test-host pattern.
	let {
		sessionId,
		entries
	}: {
		sessionId?: string;
		entries: TurnMember[];
	} = $props();
	// Intentional init-capture: props are fixed for the lifetime of this test host.
	// svelte-ignore state_referenced_locally
	if (sessionId !== undefined) setConversationSession(sessionId);

	let openChipId: string | null = null;
	let peekOpen = $state(false);
</script>

<InlineToolCalls
	entries={entries}
	runKey="r1"
	{openChipId}
	{peekOpen}
	allEntries={entries}
	ontoggleChip={() => {}}
	ontogglePeek={() => {}}
/>
