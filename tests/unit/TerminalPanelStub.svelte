<script lang="ts">
	// Test double for TerminalPanel: self-opens on mount (row mode),
	// exposes focusTerminal for the desk's ⌥+1…9 shortcut, and records
	// every lifecycle event into (globalThis).__stubPanelEvents.
	import { onMount } from 'svelte';
	let {
		assigned = null,
		onAssigned,
		onShellExit
	}: {
		assigned?: { sessionId: string; token: string } | null;
		onAssigned?: (sessionId: string, token: string) => void;
		onShellExit?: () => void;
	} = $props();
	const events = ((globalThis as { __stubPanelEvents?: unknown[] }).__stubPanelEvents ??= []);
	onMount(() => {
		events.push('mount:' + (assigned ? assigned.sessionId : 'self'));
		if (!assigned) onAssigned?.('stub-' + events.length, 'stub-tok');
	});
	export function focusTerminal(): void {
		events.push('focus');
	}
	export function exitShell(): void {
		onShellExit?.();
	}
</script>

<div data-testid="terminal-panel" data-assigned={assigned ? assigned.sessionId : ''}>stub</div>
