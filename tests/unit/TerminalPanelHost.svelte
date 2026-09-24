<script lang="ts">
	import TerminalPanel from '$lib/components/terminal/TerminalPanel.svelte';
	let { onShellExit, ...rest }: { onShellExit?: () => void } & Record<string, unknown> = $props();
</script>

<TerminalPanel {onShellExit} {...rest} />
