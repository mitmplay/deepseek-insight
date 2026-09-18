<script lang="ts">
	/**
	 * ThinkHost — test fixture (inline-tool-calls.test.ts, think-popup
	 * stick describe): wraps InlineToolCalls with $state-backed entries
	 * so tests can grow the reasoning text AFTER mount — the streaming
	 * shape the popup's stick-to-bottom follows (ScrollAreaHost pattern).
	 */
	import InlineToolCalls from '../../src/lib/components/message/InlineToolCalls.svelte';
	import type { DsiEntry } from '$lib/types';
	import type { AssistantSideEntry } from '$lib/utils/turn-grouping';

	let { initialEntries = [], openChipId = null }: { initialEntries?: DsiEntry[]; openChipId?: string | null } =
		$props();

	// Intentional initial capture: the prop seeds the fixture's transcript;
	// later growth goes through setEntries (the streaming shape under test).
	// svelte-ignore state_referenced_locally
	let entries = $state<AssistantSideEntry[]>(initialEntries as AssistantSideEntry[]);

	export function setEntries(next: DsiEntry[]): void {
		entries = next as AssistantSideEntry[];
	}
</script>

<InlineToolCalls
	{entries}
	runKey="run-1"
	{openChipId}
	peekOpen={false}
	allEntries={entries}
	ontoggleChip={() => {}}
	ontogglePeek={() => {}}
/>
