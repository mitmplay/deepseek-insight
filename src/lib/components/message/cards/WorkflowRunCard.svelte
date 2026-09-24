<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import type { DsiEntry, DsiWorkflowAgent } from '$lib/types';

	/**
	 * WorkflowRunCard — the orchestration popup body for ONE workflow run
	 * (2026-08-31): the run's display name, its live tally (done/total),
	 * and per-member rows in start order — tri-state glyph + label +
	 * phase + duration, the TodoCard glyph grammar. The entry FOLDS the
	 * four tool-workflow lifecycle events (dsh-events mergeWorkflowRun),
	 * so the card updates live as members start and settle.
	 *
	 * Presentational — the folded entry arrives as a prop; durations are
	 * display metadata from wire times (endedAt − startedAt), never billing.
	 */
	let { entry }: { entry: Extract<DsiEntry, { kind: 'workflow-run' }> } = $props();

	const done = $derived(entry.agents.filter((a) => a.status !== 'running').length);

	const statusWord: Record<Extract<DsiEntry, { kind: 'workflow-run' }>['status'], string> = {
		running: 'running',
		completed: 'completed',
		failed: 'failed',
		cancelled: 'cancelled'
	};

	function glyph(status: DsiWorkflowAgent['status']): string {
		if (status === 'completed') return '●';
		if (status === 'running') return '◐';
		return '●';
	}

	function glyphClass(status: DsiWorkflowAgent['status']): string {
		if (status === 'completed') return 'text-emerald-500';
		if (status === 'running') return 'text-accent-purple';
		if (status === 'failed') return 'text-red-500';
		return 'text-slate-300';
	}

	/** Compact wall-clock span (ms) — "42s" under a minute, "1m 05s" over. */
	function duration(a: DsiWorkflowAgent): string | null {
		if (a.startedAt <= 0 || a.endedAt === undefined || a.endedAt < a.startedAt) return null;
		const s = Math.round((a.endedAt - a.startedAt) / 1000);
		if (s < 60) return `${s}s`;
		return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
	}
</script>

<div class="p-3" data-testid="workflow-run-card" data-status={entry.status}>
	<div class="flex flex-wrap items-center gap-1.5 text-xs">
		<span class="font-medium text-text-primary" data-testid="workflow-run-name">{entry.name}</span>
		<span class="text-text-muted">·</span>
		<span class="font-mono text-[11px]" data-testid="workflow-run-tally">{done}/{entry.agents.length}</span>
		<span
			class="ml-auto font-mono text-[10px] uppercase tracking-wide {entry.status === 'running'
				? 'text-accent-purple'
				: entry.status === 'completed'
					? 'text-emerald-600'
					: 'text-red-600'}"
			data-testid="workflow-run-status"
		>
			{statusWord[entry.status]}
		</span>
	</div>
	<ul class="mt-2 flex flex-col gap-1" data-testid="workflow-run-agents">
		{#each entry.agents as agent (agent.seq)}
			<li class="flex items-start gap-2 text-xs" data-testid="workflow-agent-row" data-status={agent.status}>
				<span class="shrink-0 {glyphClass(agent.status)}" aria-hidden="true">{glyph(agent.status)}</span>
				<span class="min-w-0 flex-1">
					<span class="break-words {agent.status === 'running' ? 'text-text-primary' : 'text-text-secondary'}"
						>{agent.label}</span
					>
					{#if agent.phase}
						<span class="ml-1 font-mono text-[10px] text-text-muted">{agent.phase}</span>
					{/if}
				</span>
				{#if duration(agent) !== null}
					<span class="shrink-0 font-mono text-[10px] text-text-muted">{duration(agent)}</span>
				{/if}
			</li>
		{/each}
		{#if entry.agents.length === 0}
			<li class="text-xs text-text-muted" data-testid="workflow-run-empty">{t(m.noMembersYet)}</li>
		{/if}
	</ul>
</div>
