<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<!-- TerminalTabHeader — the desk's tablist strip (Terminal Desk ADR D1,
     Wave 2): presentation only; the desk owns selection state. -->
<div role="tablist" class="flex items-center gap-1 border-b border-slate-800 px-1 py-0.5" data-testid="terminal-tab-header">
	{@render children()}
</div>
