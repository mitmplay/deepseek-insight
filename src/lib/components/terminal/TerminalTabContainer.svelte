<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		index,
		visible,
		children
	}: { index: number; visible: boolean; children: Snippet } = $props();
</script>

<!-- TerminalTabContainer — one tab's body (Terminal Desk ADR D1): hidden
     tabs keep their rows ALIVE (streams keep running so scrollback
     accumulates — the accepted give-up, ADR §7); only visibility flips. -->
<div
	class="min-h-0 grow {visible ? 'flex' : 'hidden'} flex-col"
	hidden={!visible}
	data-testid="terminal-tab-container-{index}"
	data-visible={visible ? 'true' : 'false'}
>
	{@render children()}
</div>
