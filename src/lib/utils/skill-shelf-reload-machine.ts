/**
 * The Reload Rememberer's machine (2026-09-23, ADR "The Reload Rememberer"
 * 2026-09-22, D1+D2): reload feedback is a PERSISTED state machine, not a
 * timer. The stored facts are the phase and an absolute expiry; what the
 * button SHOWS is derived from the wall clock. This module is pure — no
 * Date.now(), no fetch, no DOM — so tests drive it with a fake clock and
 * the panel stays the only place the real world enters.
 *
 * The user decision (2026-09-23) pinned the persisted shape to D1's literal
 * wording: { phase, startedAt, doneAt? }. startedAt is recorded provenance;
 * nothing derives from it.
 */

/** The persisted blob on DsiSkillShelfPanel.reload. null = idle. */
export interface ReloadFeedback {
	phase: 'loading' | 'done';
	/** When this machine run began — provenance, not derived from. */
	startedAt: number;
	/** Absolute expiry of the done badge (phase 'done' only). */
	doneAt?: number;
}

/** How long the green check stays after a successful reload. */
export const DONE_WINDOW_MS = 5_000;

/** The only four events that may mutate the machine (ADR D2). */
export type ReloadEvent =
	| 'reloadStarted'
	| 'reloadSucceeded'
	| 'reloadFailed'
	| 'windowExpired';

/**
 * One pure transition: (state, event, now) -> next state. Every mutation —
 * click handler, seed restore, timer fire — goes through here.
 */
export function reduceReload(
	state: ReloadFeedback | null,
	event: ReloadEvent,
	now: number
): ReloadFeedback | null {
	switch (event) {
		case 'reloadStarted':
			return { phase: 'loading', startedAt: now };
		case 'reloadSucceeded':
			return {
				phase: 'done',
				startedAt: state?.startedAt ?? now,
				doneAt: now + DONE_WINDOW_MS
			};
		case 'reloadFailed':
			return null;
		case 'windowExpired':
			return null;
	}
}

/**
 * What the button should show RIGHT NOW. The deadline, not the mount moment,
 * is the contract: a done blob past its doneAt reads idle even before the
 * expiry timer fires (timer death is harmless — ADR D1).
 */
export function visiblePhase(
	state: ReloadFeedback | null,
	now: number
): 'idle' | 'loading' | 'done' {
	if (!state) return 'idle';
	if (state.phase === 'loading') return 'loading';
	return typeof state.doneAt === 'number' && now < state.doneAt ? 'done' : 'idle';
}
