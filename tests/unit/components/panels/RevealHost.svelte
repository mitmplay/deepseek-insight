<!--
	RevealHost — test harness for the Fullpath Bow D3 amended reveal: the
	HOST owns activeFile + expanded (The Settings Tree ownership contract),
	so tests can drive tab-navigation prop changes the way the floor does.
-->
<script lang="ts">
	import WorkspaceExplorerPanel from '$lib/components/panels/WorkspaceExplorerPanel.svelte';

	let { onPendingOpenConsumed }: { onPendingOpenConsumed?: (n: number) => void } = $props();
	let activeFile = $state<string | null>(null);
	let expanded = $state<string[]>([]);

	export function setActive(p: string | null): void {
		activeFile = p;
	}
</script>

<WorkspaceExplorerPanel
	sessionId="s1"
	root="/repo"
	{activeFile}
	{expanded}
	onToggle={(dir: string) => {
		expanded = expanded.includes(dir)
			? expanded.filter((d) => d !== dir)
			: [...expanded, dir];
	}}
	onOpenFile={() => {}}
	onOpenTab={() => {}}
	onCollapseAll={() => {}}
	{onPendingOpenConsumed}
/>
