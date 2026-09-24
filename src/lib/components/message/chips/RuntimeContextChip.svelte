<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * RuntimeContextChip — harness-injected runtime-context user message,
	 * collapsed to one line (Wave 2, task 2.4; PRD G2: "runtime-context
	 * paragraphs crowd the transcript").
	 *
	 * The mapper flags the entry via the fixture-pinned wire marker
	 * (meta:'runtime-context'); the full verbatim text stays on the entry —
	 * expand shows it exactly as recorded (honest, no summarizing).
	 */
	import { truncate } from '$lib/utils/truncate';

	let {
		text
	}: { text: string } = $props();

	let open = $state(false);

	const { head, truncated } = $derived(truncate(text.replace(/\s+/g, ' ').trim(), 80));
</script>

<div class="self-start text-xs" data-testid="runtime-context-chip" data-open={open}>
	<button
		type="button"
		onclick={() => (open = !open)}
		aria-expanded={open}
		data-testid="runtime-context-toggle"
		class="inline-flex max-w-xl items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-slate-400 hover:border-slate-300"
	>
		<span aria-hidden="true">{open ? '▾' : '▸'}</span>
		<span class="truncate">{t(m.runtimeContext)} {head}{truncated ? '…' : ''}</span>
	</button>
	{#if open}
		<pre
			data-testid="runtime-context-body"
			class="mt-1 max-w-2xl overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-500 ring-1 ring-slate-200"
		>{text}</pre>
	{/if}
</div>
