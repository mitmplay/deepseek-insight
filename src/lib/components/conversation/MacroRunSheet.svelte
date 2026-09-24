<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import type {
		MacroLineRecord,
		MacroRunState
	} from '$lib/services/chat/macro-runner.svelte';

	/**
	 * MacroRunSheet — the Prompt Macro's status surface (ADR D7 + D9,
	 * 2026-08-29): a collapsed CHIP above the composer that expands into
	 * the run SHEET — one row per executed line, each with one of six
	 * state marks (✓ ▶ ⏳ ⊙ ⊘ ✕).
	 *
	 * Presentational by contract (PRD Module Map): run state, per-line
	 * records, and the panel's own poll truth (running, pendingAnswers)
	 * arrive as props; every control leaves as a callback. The component
	 * never fetches, never polls, never imports the runner — the panel
	 * owns the wiring (D7: "the chip reads the panel's existing poll
	 * state; the runner itself never polls").
	 *
	 * Three truth layers (D9), honestly kept apart:
	 *   - runner-exact: ⊙ pending(held) · ⏳ queued · ⊘ skipped · ✕ failed
	 *     (and ✓ for command lines — they complete host-side, no turn)
	 *   - host-derived (≤ one events poll): ✓ done / ▶ running — the panel
	 *     computes `lineMarks` from its OWN store (groupTurns pairing);
	 *     this component only renders what it is handed
	 *   - the transcript is the ground truth — this sheet is a map
	 *
	 * ▶/✓ derivation inputs (props, never fetched): `landedTurns` = how
	 * many of the run's turns have landed at this render (the panel pairs
	 * fed lines to assistant-turn groups), `running` = the panel's own
	 * store.isStreaming — gates ▶ (the first fed line without a landed
	 * turn while a turn is in flight).
	 *
	 * Mention rows (D9): a turn in ANOTHER session cannot derive ✓ from
	 * this panel's poll — the row renders its executor note (`sent to
	 * <target>`) and progress delegates to the a2a chip stack.
	 */
	let {
		run,
		landedTurns = 0,
		running = false,
		pendingAnswers = 0,
		onfeednext,
		onrunall,
		onabort,
		onrunagain,
		onclose
	}: {
		/** The runner's reactive state (phase/total/fed/lines/note). */
		run: MacroRunState;
		/** Fed lines whose paired assistant turn has LANDED (panel-derived,
		 *  D9) — drives ✓ ahead of the runner's own ⏳. */
		landedTurns?: number;
		/** A turn is in flight on this panel's session (store.isStreaming) —
		 *  gates ▶ and the queued-behind suffix. */
		running?: boolean;
		/** Pending answerer cards on this panel (store.answerList count) —
		 *  drives the `the harness is asking` suffix. Never auto-answered. */
		pendingAnswers?: number;
		/** [Feed next] — held runs: submit exactly one line (D10). */
		onfeednext?: () => void;
		/** [Run all] — held runs: release the hold (D10). */
		onrunall?: () => void;
		/** Stop/Abort — drop UNFED lines only (forward-only, D10). */
		onabort?: () => void;
		/** [Run again] — ended runs re-enter the same loop (D10). */
		onrunagain?: () => void;
		/** Close (✕) — ended runs dismiss the sheet (panel calls runner dismiss). */
		onclose?: () => void;
	} = $props();

	/** Sheet expanded state — the chip toggles it (click again to collapse). */
	let expanded = $state(false);

	/** The run is over (either ending) — [Run again] appears (D10). */
	const ended = $derived(run.phase === 'fed' || run.phase === 'stopped' || run.phase === 'failed');
	/** A live run could still feed (held or mid-feed) — Stop means
	 *  "stop sending more"; once everything is queued there is nothing
	 *  left to hold (abort-after-queued honesty, D10). */
	const unfedRemain = $derived(run.fed < run.total);
	const canAbort = $derived((run.phase === 'held' || run.phase === 'feeding') && unfedRemain);

	/** Collapsed-chip suffixes (D5/D7): the honest queued/asking labels. */
	const asking = $derived(pendingAnswers > 0);
	const queuedSuffix = $derived.by(() => {
		if (asking) return ' · the harness is asking';
		if (running && unfedRemain) return ' · queued behind the running turn';
		return '';
	});

	/** The line the chip names while feeding/held — the next unfed
	 *  section's display (feeding k/n · <display>), else the last
	 *  record's display. */
	const currentLine = $derived.by(() => {
		const next = run.lines.find((l) => l.state === 'pending' && !l.isQuery);
		if (next) return next.display;
		return run.lines.length > 0 ? run.lines[run.lines.length - 1].display : '';
	});

	/** Chip label per phase (D7): feeding k/n · all-queued k queued ·
	 *  stopped · failed — plus the suffixes above. Sections counted (a
	 *  block is one — D15). */
	const chipLabel = $derived.by(() => {
		if (run.phase === 'feeding') return `macro ▸ ${run.fed + 1}/${run.total} · ${currentLine}`;
		if (run.phase === 'held') return `macro ⏸ held · ${run.fed}/${run.total}${queuedSuffix}`;
		if (run.phase === 'fed')
			return `macro ${unfedRemain ? `${run.total - run.fed} queued` : '✓ fed'} · ${run.total} section${run.total === 1 ? '' : 's'}${queuedSuffix}`;
		if (run.phase === 'stopped') return `macro ⏹ stopped · ${run.note ?? ''}`;
		return `macro ✕ failed · ${run.note ?? ''}`;
	});

	/**
	 * The six-state mark for one row (D9), classified by the record's
	 * TYPED kind — never note-text sniffing (W2 2.2 killed it: a
	 * /permission note shifted every later ✓/▶ pairing by one):
	 *   - command rows (both /new and /permission) are terminal
	 *     host-side → ✓ on receipt, no turn to wait for
	 *   - mention rows delegate progress to the a2a chip stack → ↗
	 *   - query rows resolved into the rows below them → ⌕
	 *   - send rows upgrade ⏙→▶→✓ from the panel-derived landedTurns —
	 *     the k-th turn-capable fed row is done when landedTurns ≥ k
	 */
	function markFor(rec: MacroLineRecord): string {
		if (rec.state === 'failed') return '✕';
		if (rec.state === 'skipped') return '⊘';
		if (rec.state === 'pending') return '⊙';
		if (rec.kind === 'query') return '⌕'; // resolved into the rows below it
		if (rec.kind === 'mention') return '↗'; // sent to target — a2a stack owns progress
		if (rec.kind === 'command') return '✓'; // host-side instant: /new AND /permission
		// send (queued): ✓/▶ from the panel's own poll pairing
		const turnIndex = turnOrdinal(rec);
		if (landedTurns >= turnIndex) return '✓';
		if (running && turnIndex === landedTurns + 1) return '▶';
		return '⏳';
	}

	/** 1-based ordinal of this record among TURN-CAPABLE fed rows (send
	 *  rows only — the only rows whose turns this panel's store can pair;
	 *  kind-driven, so a /permission between blocks shifts NOTHING). */
	function turnOrdinal(rec: MacroLineRecord): number {
		let n = 0;
		for (const l of run.lines) {
			if (l === rec) return n + 1;
			if (l.state === 'queued' && l.kind === 'send') n += 1;
		}
		return n + 1;
	}

	/** State text for the row's aria-label / title (screen-reader truth). */
	function stateText(mark: string): string {
		switch (mark) {
			case '✓':
				return 'done';
			case '▶':
				return 'running';
			case '⏳':
				return 'queued';
			case '⊙':
				return 'pending (held)';
			case '⊘':
				return 'skipped';
			case '✕':
				return 'failed';
			case '⌕':
				return 'resolved';
			case '↗':
				return 'sent to target';
			default:
				return mark;
		}
	}
</script>

{#if run.phase !== 'idle'}
	<div class="macro-run" data-testid="macro-run">
		<!-- Collapsed chip (D7): the always-visible layer. Click toggles the
		     sheet; Stop is forward-only (unfed lines drop; queued are the
		     host's — the suffix names the boundary). -->
		<div class="macro-chip" data-phase={run.phase} data-testid="macro-chip">
			<button
				type="button"
				class="macro-chip-label"
				onclick={() => (expanded = !expanded)}
				aria-expanded={expanded}
				title={run.note ?? 'Macro run'}
			>
				<span class="macro-chip-text">{chipLabel}</span>
				<span class="macro-chip-caret">{expanded ? '▾' : '▸'}</span>
			</button>
			{#if canAbort && onabort}
				<button
					type="button"
					class="macro-stop"
					data-testid="macro-stop"
					onclick={onabort}
					title={t(m.dropUnsubmittedTitle)}
				>
					{t(m.stop)}
				</button>
			{/if}
			{#if ended && onclose}
				<button
					type="button"
					class="macro-close"
					data-testid="macro-close"
					onclick={onclose}
					aria-label={t(m.dismissRunSheet)}
					title={t(m.dismiss)}
				>
					✕
				</button>
			{/if}
		</div>

		{#if expanded}
			<!-- Expanded sheet (D9): one row per executed line. -->
			<div class="macro-sheet" data-testid="macro-sheet">
				{#each run.lines as rec (rec.index)}
					<div
						class="macro-row"
						class:query-row={rec.isQuery}
						data-testid="macro-line"
						data-state={stateText(markFor(rec))}
					>
						<span class="macro-mark" title={stateText(markFor(rec))}>{markFor(rec)}</span>
						<span class="macro-line-text" title={rec.sendText}>{rec.display}</span>
						{#if rec.lineCount > 1}
							<span class="macro-line-n">+{rec.lineCount - 1} lines</span>
						{/if}
						{#if rec.note}
							<span class="macro-line-note">{rec.note}</span>
						{/if}
					</div>
				{/each}
				{#if run.lines.length === 0}
					<div class="macro-empty">{t(m.noSectionsFed)}</div>
				{/if}

				<!-- Held controls (D10): entry-time supervision — Feed next
				     (one line), Run all (release), Abort (drop unfed). -->
				{#if run.phase === 'held'}
					<div class="macro-controls" data-testid="macro-held-controls">
						{#if onfeednext}
							<button type="button" data-testid="macro-feednext" onclick={onfeednext}>
								{t(m.feedNext)}
							</button>
						{/if}
						{#if onrunall}
							<button type="button" data-testid="macro-runall" onclick={onrunall}>
								{t(m.runAll)}
							</button>
						{/if}
						{#if canAbort && onabort}
							<button type="button" data-testid="macro-abort" onclick={onabort}>
								{t(m.abort)}
							</button>
						{/if}
					</div>
				{/if}

				<!-- Run again (D10): ended runs only — /new mints a fresh
				     session each time, as the ADR records. -->
				{#if ended && onrunagain}
					<div class="macro-controls">
						<button type="button" data-testid="macro-runagain" onclick={onrunagain}>
							{t(m.runAgain)}
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.macro-run {
		margin: 0 0.5rem 0.25rem;
		font-size: 0.75rem;
	}
	.macro-chip {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.125rem 0.5rem;
		border-radius: 6px;
		background: rgba(59, 130, 246, 0.1);
		color: #1d4ed8;
	}
	.macro-chip[data-phase='failed'] {
		background: rgba(239, 68, 68, 0.12);
		color: #b91c1c;
	}
	.macro-chip[data-phase='stopped'] {
		background: rgba(107, 114, 128, 0.12);
		color: #4b5563;
	}
	.macro-chip-label {
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
	.macro-chip-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.macro-chip-caret {
		flex-shrink: 0;
		opacity: 0.7;
	}
	.macro-stop {
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
	.macro-stop:hover {
		background: rgba(239, 68, 68, 0.12);
	}
	.macro-close {
		flex-shrink: 0;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0 0.25rem;
		font-size: 0.75rem;
		line-height: 1.4;
		opacity: 0.7;
	}
	.macro-close:hover {
		opacity: 1;
	}

	.macro-sheet {
		margin-top: 0.25rem;
		border: 1px solid rgba(59, 130, 246, 0.25);
		border-radius: 6px;
		background: var(--color-surface-elevated, #ffffff);
		padding: 0.375rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.macro-row {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		min-width: 0;
	}
	.macro-row.query-row .macro-line-text {
		font-style: italic;
		opacity: 0.8;
	}
	.macro-mark {
		flex-shrink: 0;
		width: 1.1em;
		text-align: center;
	}
	.macro-line-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-primary, #212529);
	}
	.macro-line-n {
		flex-shrink: 0;
		color: var(--color-text-muted, #868e96);
		font-size: 0.6875rem;
	}
	.macro-line-note {
		flex-shrink: 0;
		max-width: 45%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-muted, #868e96);
	}
	.macro-empty {
		color: var(--color-text-muted, #868e96);
		padding: 0.125rem 0;
	}
	.macro-controls {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}
	.macro-controls button {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-primary, #212529);
		cursor: pointer;
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
	}
	.macro-controls button:hover {
		background: var(--color-surface-hover, #e9ecef);
	}
</style>
