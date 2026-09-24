<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * TodoCard — the todo_write chip popup body (ADR-0009, 2026-08-26):
	 * the whole-list snapshot renders as a checkbox plan — tri-state
	 * glyphs, a done/total header, and delta accents derived by diffing
	 * the previous snapshot in the same transcript (just-completed rows
	 * accented, the active row marked). A rewritten text set reads
	 * honestly as a NEW PLAN, not a fake delta. The harness's own
	 * digest line rides as the footer; the verbatim wire stays one
	 * disclosure away (raw JSON toggle — the family pattern).
	 *
	 * Presentational — props are raw wire strings; parsing is the pure
	 * todo-lists.ts functions. Junk args fall back to the raw panes
	 * directly — never an empty card.
	 *
	 * XSS posture: every field renders as a TEXT node — no {@html} sink
	 * in this component (BC-12).
	 */
	import { ListChecks } from '@lucide/svelte';
	import { diffTodoLists, parseTodoList, type TodoDelta, type TodoStatus } from '$lib/utils/todo-lists';

	let {
		argsRaw,
		prevArgsRaw,
		resultText
	}: { argsRaw?: string; prevArgsRaw?: string; resultText?: string } = $props();

	const list = $derived(parseTodoList(argsRaw));
	const prev = $derived(parseTodoList(prevArgsRaw));
	/** Junk args → plain raw view, no card chrome. */
	const rawOnly = $derived(list === undefined);

	/** Delta annotations vs the previous snapshot; undefined = new plan. */
	const deltas = $derived(list !== undefined && prev !== undefined ? diffTodoLists(prev, list) : undefined);
	const done = $derived(list?.items.filter((i) => i.status === 'completed').length ?? 0);
	const active = $derived(list?.items.find((i) => i.status === 'in_progress'));

	/** Tri-state glyph per status (text nodes — no icon font). */
	function glyph(status: TodoStatus): string {
		if (status === 'completed') return '●';
		if (status === 'in_progress') return '◐';
		return '○';
	}

	function glyphClass(status: TodoStatus, delta: TodoDelta | undefined): string {
		if (delta?.kind === 'just-completed') return 'text-emerald-600';
		if (status === 'completed') return 'text-emerald-500';
		if (status === 'in_progress') return 'text-accent-purple';
		return 'text-slate-300';
	}

	let rawOpen = $state(false);
</script>

{#if rawOnly}
	<!-- Junk args: the honest raw view, exactly ToolCallDetail's panes. -->
	<div class="p-2">
		{#if argsRaw !== undefined}
			<pre
				data-testid="todo-raw-args"
				class="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200"
			>{argsRaw}</pre>
		{/if}
		{#if resultText !== undefined}
			<pre
				data-testid="todo-raw-result"
				class="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200"
			>{resultText}</pre>
		{/if}
	</div>
{:else}
	<div class="p-3" data-testid="todo-card">
		<div class="flex flex-wrap items-center gap-1.5 text-xs">
			<ListChecks size={12} class="shrink-0 text-accent-purple" aria-hidden="true" />
			<span class="font-medium text-text-primary" data-testid="todo-card-title">
				{done}/{list!.items.length} done
			</span>
			{#if active !== undefined}
				<span class="text-text-muted">{t(m.oneInProgress)}</span>
			{/if}
			{#if deltas === undefined && prev !== undefined}
				<!-- A rewritten text set: honest new-plan badge, never a fake delta. -->
				<span
					class="rounded-full border border-slate-200 px-1.5 py-px text-[10px] text-slate-500"
					data-testid="todo-new-plan"
				>{t(m.newPlan)}</span>
			{/if}
		</div>

		<ul class="mt-1.5 flex flex-col gap-0.5" data-testid="todo-rows">
			{#each list!.items as item (item.content)}
				{@const delta = deltas?.get(item.content)}
				<li
					class="flex items-start gap-1.5 text-xs"
					data-testid="todo-row"
					data-status={item.status}
					data-delta={delta?.kind ?? ''}
				>
					<span class="mt-px w-3 shrink-0 text-center font-mono {glyphClass(item.status, delta)}"
						aria-hidden="true">{glyph(item.status)}</span>
					<span class="min-w-0 break-words {item.status === 'completed' ? 'text-text-muted line-through decoration-slate-300' : delta?.kind === 'now-active' ? 'font-medium text-text-primary' : 'text-text-secondary'}"
					>{item.content}</span>
				</li>
			{/each}
		</ul>

		{#if resultText !== undefined}
			<!-- Footer: the harness's own digest — it said it, the card shows it. -->
			<p class="mt-1.5 text-[10px] text-text-muted" data-testid="todo-digest">{resultText}</p>
		{/if}

		<button
			type="button"
			data-testid="todo-raw-toggle"
			onclick={() => (rawOpen = !rawOpen)}
			class="mt-1 text-[11px] text-slate-400 underline hover:text-slate-600"
		>
			{rawOpen ? t(m.hideRawJson) : t(m.rawJson)}
		</button>
		{#if rawOpen}
			{#if argsRaw !== undefined}
				<pre
					data-testid="todo-raw-args"
					class="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200"
				>{argsRaw}</pre>
			{/if}
			{#if resultText !== undefined}
				<pre
					data-testid="todo-raw-result"
					class="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200"
				>{resultText}</pre>
			{/if}
		{/if}
	</div>
{/if}
