<script lang="ts">
	import TerminalPanel from '$lib/components/terminal/TerminalPanel.svelte';
	let { onShellExit }: { onShellExit?: () => void } = $props();
</script>

<TerminalPanel {onShellExit} />
