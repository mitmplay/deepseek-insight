<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * ToolCallDetail — args/result panes for an expanded tool chip, rendered
	 * inside a ChipPopup AFTER the chip row (OCI ChipDetail pattern,
	 * 2026-08-22). Panes render as CODE — tool payloads are data, not
	 * prose (BC-12) — EXCEPT a read result that carries the wire's
	 * presentation view (view.card === 'read'): FileContentViewer renders
	 * markdown files as prose and source files with syntax highlighting
	 * (ts/js/svelte/css/json/…), OCI ChipDetail parity.
	 */
	import FileContentViewer from '$lib/components/message/FileContentViewer.svelte';
	import type { DsiReadView } from '$lib/types';

	let {
		argsRaw,
		resultText,
		summary,
		readView
	}: {
		argsRaw?: string;
		resultText?: string;
		summary?: string;
		/** Wire: read-result presentation view (when present, replaces the
		 * flat result pre with the typed file view). */
		readView?: DsiReadView;
	} = $props();

	/** Result pane: truncated by default, expands to the full wire text. */
	let resultExpanded = $state(false);
	const RESULT_TRUNC = 480;

	const resultTruncated = $derived(resultText !== undefined && !resultExpanded && resultText.length > RESULT_TRUNC);
	const resultShown = $derived(
		resultText === undefined ? undefined : resultExpanded ? resultText : resultText.slice(0, RESULT_TRUNC)
	);
</script>

<div class={readView !== undefined ? '' : 'p-2'}>
	{#if readView !== undefined}
		<FileContentViewer view={readView} />
	{:else}
		{#if argsRaw !== undefined}
			<pre
				data-testid="tool-chip-args"
				class="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200"
			>{argsRaw}</pre>
		{/if}
		{#if resultShown !== undefined}
			<pre
				data-testid="tool-chip-result"
				class="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200"
			>{resultShown}</pre>
			{#if resultText && resultText.length > RESULT_TRUNC}
				<button
					type="button"
					data-testid="tool-chip-result-toggle"
					onclick={() => (resultExpanded = !resultExpanded)}
					class="mt-0.5 text-[11px] text-slate-400 underline hover:text-slate-600"
				>
					{resultExpanded ? t(m.showLess) : t(m.showFullResult)}
				</button>
			{/if}
		{:else if summary && argsRaw === undefined}
			<!-- legacy summary pane only when there is NO raw args pane —
			     args show once. -->
			<pre
				data-testid="tool-chip-detail"
				class="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200"
			>{summary}</pre>
		{/if}
	{/if}
</div>
