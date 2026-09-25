<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children, actions }: { children: Snippet; actions?: Snippet } = $props();
</script>

<!-- TerminalTabHeader — the desk's tablist strip (Terminal Desk ADR D1,
     Wave 2): presentation only; the desk owns selection state. The
     optional actions snippet rides the RIGHT edge (ml-auto) — the
     copy-as-image button lives there. -->
<div role="tablist" class="flex items-center gap-1 border-b border-slate-800 px-1 py-0.5" data-testid="terminal-tab-header">
	{@render children()}
	{#if actions}
		<div class="ml-auto flex items-center" data-testid="terminal-tab-header-actions">
			{@render actions()}
		</div>
	{/if}
</div>
