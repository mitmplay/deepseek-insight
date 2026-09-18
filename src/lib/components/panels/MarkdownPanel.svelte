<script lang="ts">
	/**
	 * MarkdownPanel — the .md member's read surface (The Loadinjected ADR
	 * D1): the transcript's own markdown renderer over the LOGGED payload.
	 * A thin wrapper — MarkdownContent is REUSED unchanged (BC-12: the
	 * byte-exact surface stays the transcript's chips; here prose may
	 * reflow, the accepted give-up).
	 */
	import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';

	let {
		content
	}: {
		/** The logged document text (never a live-file read). */
		content: string;
	} = $props();
</script>

<div class="markdown-panel" data-testid="markdown-panel">
	<MarkdownContent {content} />
</div>

<style>
	.markdown-panel {
		height: 100%;
		overflow: auto;
		padding: 1rem 1.25rem;
	}
</style>
