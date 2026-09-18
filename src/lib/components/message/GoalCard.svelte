<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * GoalCard — the goal tool family's chip popup body (get_goal /
	 * create_goal / update_goal, 2026-08-26): the objective renders as
	 * prose ONCE (the paired result repeats it verbatim — the raw
	 * ToolCallDetail panes duplicated it, the dense-JSON problem this
	 * card deletes), enums render as badges, short scalars pack one
	 * mono meta line. The verbatim wire stays one disclosure away (raw
	 * JSON toggle) — the same honest-escape-hatch pattern as
	 * ToolCallDetail's show-full-result.
	 *
	 * Presentational — props are raw wire strings; parsing is the pure
	 * goals.ts functions. When NEITHER side parses, the raw panes render
	 * directly (no toggle) — junk never shows an empty card.
	 *
	 * XSS posture: every field renders as a TEXT node — no {@html} sink
	 * in this component (BC-12).
	 */
	import { Target } from '@lucide/svelte';
	import { goalVerb, parseGoalArgs, parseGoalResult, type GoalPhase } from '$lib/utils/goals';

	let {
		toolName,
		argsRaw,
		resultText
	}: { toolName: string; argsRaw?: string; resultText?: string } = $props();

	const args = $derived(parseGoalArgs(argsRaw));
	const result = $derived(parseGoalResult(resultText));
	/** Junk on both sides → plain raw view, no card chrome. */
	const rawOnly = $derived(args === undefined && result === undefined);

	const verb = $derived(goalVerb(toolName, args?.action));
	const goal = $derived(result?.goal);
	/** The ONE objective — args win (what was asked), result fills reads. */
	const objective = $derived(args?.objective ?? goal?.objective);

	/** Phase badge classes (goal/changed semantics: active runs, complete
	 * landed, paused idle, blocked failed). */
	const phaseClass = $derived.by(() => {
		switch (goal?.phase) {
			case 'active':
				return 'bg-amber-50 text-amber-700 border-amber-200';
			case 'complete':
				return 'bg-emerald-50 text-emerald-700 border-emerald-200';
			case 'paused':
				return 'bg-slate-50 text-slate-600 border-slate-200';
			case 'blocked':
				return 'bg-red-50 text-red-700 border-red-200';
			default:
				return '';
		}
	});

	/** Short scalars packed for one mono line: revision, rounds, goal id. */
	const metaBits = $derived.by(() => {
		if (goal === null || goal === undefined) return args?.max_goal_rounds !== undefined ? [`cap ${args.max_goal_rounds}`] : [];
		const bits = [`rev ${goal.revision}`, `round ${goal.roundsStarted}/${goal.maxGoalRounds}`];
		if (args?.goal_id !== undefined && args.goal_id !== goal.id) bits.push(args.goal_id);
		bits.push(goal.id);
		return bits;
	});

	let rawOpen = $state(false);
</script>

{#if rawOnly}
	<!-- Junk payloads: the honest raw view, exactly ToolCallDetail's panes. -->
	<div class="p-2">
		{#if argsRaw !== undefined}
			<pre
				data-testid="goal-raw-args"
				class="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200"
			>{argsRaw}</pre>
		{/if}
		{#if resultText !== undefined}
			<pre
				data-testid="goal-raw-result"
				class="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200"
			>{resultText}</pre>
		{/if}
	</div>
{:else}
	<div class="p-3" data-testid="goal-card" data-phase={goal?.phase}>
		<div class="flex flex-wrap items-center gap-1.5 text-xs">
			<Target size={12} class="shrink-0 text-accent-purple" aria-hidden="true" />
			<span class="font-medium text-text-primary" data-testid="goal-card-title">
				{t(m.goal)}{verb !== undefined ? ` ${verb}` : ''}
			</span>
			{#if goal !== undefined && goal !== null}
				<span
					class="rounded-full border px-1.5 py-px text-[10px] font-medium {phaseClass}"
					data-testid="goal-phase"
					data-phase={goal.phase}
				>{goal.phase}</span>
			{/if}
			{#if result?.activation !== undefined}
				<span
					class="rounded-full border px-1.5 py-px text-[10px] {result.activation === 'armed'
						? 'border-emerald-200 text-emerald-700'
						: 'border-slate-200 text-slate-500'}"
					data-testid="goal-activation"
				>{result.activation}</span>
			{/if}
		</div>

		{#if objective !== undefined}
			<p
				class="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-text-secondary"
				data-testid="goal-objective"
			>{objective}</p>
		{:else if goal === null}
			<p class="mt-1.5 text-xs text-slate-400" data-testid="goal-empty">{t(m.noGoalSet)}</p>
		{/if}

		{#if goal?.blockedReason !== undefined}
			<p class="mt-1 text-xs text-red-700" data-testid="goal-blocked">
				{goal.blockedReason.code} — {goal.blockedReason.message}
			</p>
		{/if}

		{#if metaBits.length > 0}
			<p class="mt-1 font-mono text-[10px] break-all text-text-muted" data-testid="goal-meta">
				{metaBits.join(' · ')}
			</p>
		{/if}

		<button
			type="button"
			data-testid="goal-raw-toggle"
			onclick={() => (rawOpen = !rawOpen)}
			class="mt-1 text-[11px] text-slate-400 underline hover:text-slate-600"
		>
			{rawOpen ? t(m.hideRawJson) : t(m.rawJson)}
		</button>
		{#if rawOpen}
			{#if argsRaw !== undefined}
				<pre
					data-testid="goal-raw-args"
					class="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200"
				>{argsRaw}</pre>
			{/if}
			{#if resultText !== undefined}
				<pre
					data-testid="goal-raw-result"
					class="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200"
				>{resultText}</pre>
			{/if}
		{/if}
	</div>
{/if}
