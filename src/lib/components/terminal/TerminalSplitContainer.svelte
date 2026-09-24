<script lang="ts">
	import type { Snippet } from 'svelte';

	let { rowCount, children }: { rowCount: number; children: Snippet } = $props();
</script>

<!-- TerminalSplitContainer — a tab's stacked rows (Terminal Desk ADR
     D4): equal flex heights; the container scrolls ONLY when more than
     one row exists (a single-row tab never scrolls). -->
<div
	class="flex min-h-0 grow flex-col gap-0.5 {rowCount > 1 ? 'overflow-y-auto' : 'overflow-hidden'}"
	data-testid="terminal-split-container"
	data-rows={rowCount}
>
	{@render children()}
</div>
