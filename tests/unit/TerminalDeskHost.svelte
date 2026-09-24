<script lang="ts">
	import TerminalDesk from '$lib/components/terminal/TerminalDesk.svelte';
	import type { TerminalDeskMirror } from '$lib/types';

	let {
		register,
		onShellExit,
		restored,
		onMirror
	}: {
		register?: (d: unknown) => void;
		onShellExit?: () => void;
		restored?: TerminalDeskMirror | null;
		onMirror?: (m: TerminalDeskMirror) => void;
	} = $props();
	let desk: unknown = $state(null);
	$effect(() => {
		register?.(desk);
	});
</script>

<TerminalDesk bind:this={desk} {restored} {onMirror} {onShellExit} />
