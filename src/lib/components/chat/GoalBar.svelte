<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import type { GoalResultGoal } from '$lib/utils/goals';

	/**
	 * GoalBar — the session goal's status surface (ADR "The Goal Bar",
	 * 2026-09-08, D2): a collapsed CHIP above the composer — phase label
	 * plus truncated objective — that expands into the goal SHEET (rounds
	 * counter, blocked reason when present).
	 *
	 * Presentational by contract (the MacroRunSheet template): the goal
	 * value arrives as a prop; every action leaves as a zero-arg callback
	 * the panel maps to `/goal <verb>` lines. The component never fetches,
	 * never polls, imports no services and no projection module — the
	 * panel owns the wiring.
	 *
	 * Render contract (D4, mirroring DSH's client GoalBar): the bar
	 * renders ONLY for phase active / paused / blocked — no goal (null),
	 * an undelivered key (undefined), or phase `complete` render nothing;
	 * `blocked` surfaces the blocked reason as the chip's title and hides
	 * Pause. Actions are fire-and-forget (ADR give-up): the next
	 * projection delta corrects the chip, no CAS.
	 */
	let {
		goal,
		onpause,
		onresume,
		onclear,
		oncreate,
		onedit,
		editor,
		oneditinput,
		oneditsubmit,
		oneditcancel
	}: {
		/** The validated goal value from goal-projection — null/undefined
		 *  and phase `complete` render nothing. */
		goal: GoalResultGoal | null | undefined;
		/** Pause an active goal → panel sends `/goal pause`. */
		onpause?: () => void;
		/** Resume a paused goal → panel sends `/goal resume`. */
		onresume?: () => void;
		/** Clear the goal → panel sends `/goal clear`. */
		onclear?: () => void;
		/** No goal present → panel opens create (`/goal create <objective>`). */
		oncreate?: () => void;
		/** Edit the objective → panel opens edit (`/goal edit <objective>`). */
		onedit?: () => void;
		/** Open editor state (panel-owned, pre-filled) — non-null renders the
		 *  form below the chip (Goal Editor ADR D2/D4: the panel owns the
		 *  state; this component renders fields and emits callbacks only). */
		editor?: { objective: string; maxGoalRounds: number } | null;
		/** One field changed in the form → panel updates its editor state. */
		oneditinput?: (field: 'objective' | 'maxGoalRounds', value: string) => void;
		/** Enter / Save → the panel diffs against the current goal and submits. */
		oneditsubmit?: () => void;
		/** Escape / Cancel → the panel discards the editor. */
		oneditcancel?: () => void;
	} = $props();

	/** Sheet expanded state — the chip toggles it (click again to collapse). */
	let expanded = $state(false);

	/** The blocked phase carries its reason; the chip title shows it. */
	const blockedTitle = $derived(
		goal?.phase === 'blocked' && goal.blockedReason
			? "blocked: " + goal.blockedReason.code + " — " + goal.blockedReason.message
			: undefined
	);

	/** The chip's phase glyph (mirrors DSH's GoalBar language). */
	const glyph = $derived.by(() => {
		if (!goal) return '';
		if (goal.phase === 'paused') return '⏸';
		if (goal.phase === 'blocked') return '⚠';
		return '▶';
	});


	/** The objective the chip names, truncated for the one-line title. */
	const shortObjective = $derived(
		goal && goal.objective.length > 80 ? goal.objective.slice(0, 79) + '…' : (goal?.objective ?? '')
	);

	/** Which phase action the chip offers: Pause on active, Resume on
	 *  paused, none on blocked (the host demands a reason fix first). */
	const phaseAction = $derived(
		goal?.phase === 'active' ? 'pause' : goal?.phase === 'paused' ? 'resume' : undefined
	);
</script>

{#if goal && goal.phase !== 'complete'}
	<div class="goal-bar" data-testid="goal-bar">
		<!-- Collapsed chip (D2): the always-visible layer. Click toggles
		     the sheet; the phase action sits beside it. -->
		<div class="goal-chip" data-phase={goal.phase} data-testid="goal-chip" title={blockedTitle}>
			<button
				type="button"
				class="goal-chip-label"
				onclick={() => (expanded = !expanded)}
				aria-expanded={expanded}
				title={blockedTitle ?? goal.objective}
			>
				<span class="goal-chip-glyph" aria-hidden="true">{glyph}</span>
				<span class="goal-chip-text">goal {goal.phase} · {shortObjective}</span>
				<span class="goal-chip-caret">{expanded ? '▾' : '▸'}</span>
			</button>
			{#if phaseAction === 'pause' && onpause}
				<button
					type="button"
					class="goal-action"
					data-testid="goal-pause"
					onclick={onpause}
					title={t(m.pauseGoal)}
				>
					{t(m.pause)}
				</button>
			{/if}
			{#if phaseAction === 'resume' && onresume}
				<button
					type="button"
					class="goal-action"
					data-testid="goal-resume"
					onclick={onresume}
					title={t(m.resumeGoal)}
				>
					{t(m.resume)}
				</button>
			{/if}
			{#if onedit}
				<button
					type="button"
					class="goal-action"
					data-testid="goal-edit"
					onclick={onedit}
					title={t(m.editObjectiveTitle)}
				>
					{t(m.edit)}
				</button>
			{/if}
			{#if onclear}
				<button
					type="button"
					class="goal-action goal-clear"
					data-testid="goal-clear"
					onclick={onclear}
					aria-label={t(m.clearTheGoal)}
					title={t(m.clearBtn)}
				>
					✕
				</button>
			{/if}
		</div>

		{#if editor}
			<!-- Editor form (Goal Editor ADR D2): pre-filled fields, Enter
			     submits, Escape cancels; buttons mirror the keys. -->
			<div class="goal-edit-form" data-testid="goal-edit-form">
				<label class="goal-edit-label">
					<span>objective</span>
					<textarea
						data-testid="goal-edit-objective"
						rows="2"
						value={editor.objective}
						oninput={(e) => oneditinput?.('objective', (e.currentTarget as HTMLTextAreaElement).value)}
						onkeydown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey) {
								e.preventDefault();
								oneditsubmit?.();
							} else if (e.key === 'Escape') {
								oneditcancel?.();
							}
						}}></textarea>
				</label>
				<label class="goal-edit-label">
					<span>{t(m.maxRounds)}</span>
					<input
						type="number"
						min="1"
						step="1"
						data-testid="goal-edit-rounds"
						value={editor.maxGoalRounds}
						oninput={(e) => oneditinput?.('maxGoalRounds', (e.currentTarget as HTMLInputElement).value)}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								oneditsubmit?.();
							} else if (e.key === 'Escape') {
								oneditcancel?.();
							}
						}}
					/>
				</label>
				<div class="goal-controls">
					<button type="button" data-testid="goal-edit-submit" onclick={() => oneditsubmit?.()}>{t(m.save)}</button>
					<button type="button" data-testid="goal-edit-cancel" onclick={() => oneditcancel?.()}>{t(m.cancel)}</button>
				</div>
			</div>
		{/if}

		{#if expanded}
			<!-- Expanded sheet (D2): rounds, phase detail, blocked reason. -->
			<div class="goal-sheet" data-testid="goal-sheet">
				<div class="goal-row">
					<span class="goal-key">objective</span>
					<span class="goal-value" title={goal.objective}>{goal.objective}</span>
				</div>
				<div class="goal-row">
					<span class="goal-key">phase</span>
					<span class="goal-value">{goal.phase}{blockedTitle ? " — " + blockedTitle : ""}</span>
				</div>
				<div class="goal-row">
					<span class="goal-key">rounds</span>
					<span class="goal-value">{goal.roundsStarted} of {goal.maxGoalRounds} max</span>
				</div>
				{#if onedit || onclear}
					<div class="goal-controls">
						{#if onedit}
							<button type="button" data-testid="goal-edit-sheet" onclick={onedit}>{t(m.editObjective)}</button>
						{/if}
						{#if onclear}
							<button type="button" data-testid="goal-clear-sheet" onclick={onclear}>{t(m.clearGoal)}</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.goal-bar {
		margin: 0 0.5rem 0.25rem;
		font-size: 0.75rem;
	}
	.goal-chip {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.125rem 0.5rem;
		border-radius: 6px;
		background: rgba(16, 185, 129, 0.1);
		color: #047857;
	}
	.goal-chip[data-phase='paused'] {
		background: rgba(107, 114, 128, 0.12);
		color: #4b5563;
	}
	.goal-chip[data-phase='blocked'] {
		background: rgba(245, 158, 11, 0.14);
		color: #b45309;
	}
	.goal-chip-label {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.25rem;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0.125rem 0;
		font-size: 0.75rem;
		text-align: left;
		min-width: 0;
	}
	.goal-chip-glyph {
		flex-shrink: 0;
		width: 1.1em;
		text-align: center;
	}
	.goal-chip-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.goal-chip-caret {
		flex-shrink: 0;
		opacity: 0.7;
	}
	.goal-action {
		flex-shrink: 0;
		border: 1px solid currentColor;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0 0.375rem;
		font-size: 0.6875rem;
		line-height: 1.4;
	}
	.goal-action:hover {
		background: rgba(0, 0, 0, 0.06);
	}
	.goal-clear {
		border: none;
		padding: 0 0.25rem;
		font-size: 0.75rem;
		opacity: 0.7;
	}
	.goal-clear:hover {
		opacity: 1;
		background: transparent;
	}
	.goal-edit-form {
		margin-top: 0.25rem;
		border: 1px solid rgba(16, 185, 129, 0.3);
		border-radius: 6px;
		background: var(--color-surface-elevated, #ffffff);
		padding: 0.375rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.goal-edit-label {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		font-size: 0.6875rem;
		color: var(--color-text-muted, #868e96);
	}
	.goal-edit-label textarea,
	.goal-edit-label input {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		font-size: 0.75rem;
		padding: 0.125rem 0.25rem;
	}
	.goal-sheet {
		margin-top: 0.25rem;
		border: 1px solid rgba(16, 185, 129, 0.3);
		border-radius: 6px;
		background: var(--color-surface-elevated, #ffffff);
		padding: 0.375rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.goal-row {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		min-width: 0;
	}
	.goal-key {
		flex-shrink: 0;
		width: 4.5rem;
		color: var(--color-text-muted, #868e96);
	}
	.goal-value {
		flex: 1;
		min-width: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--color-text-primary, #212529);
	}
	.goal-controls {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}
	.goal-controls button {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-primary, #212529);
		cursor: pointer;
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
	}
	.goal-controls button:hover {
		background: var(--color-surface-hover, #e9ecef);
	}
</style>