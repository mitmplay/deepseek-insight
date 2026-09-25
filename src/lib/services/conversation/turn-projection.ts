/**
 * turn-projection — Turn End Stamp (ADR 2026-09-25, D1).
 *
 * Folds turn-lifecycle MARKER entries (mapped by dsh-events from
 * turn/start + turn/end) into per-turn lifecycle records, and joins a
 * turn GROUP (turn-grouping.ts) to its record by strict seq adjacency:
 * the record brackets the group when its start seq precedes the group's
 * first entry seq and its end seq follows the group's last entry seq.
 *
 * Pure derivation over the entries list — the render site calls it, no
 * module state, no store change (PRD Module Communication Map).
 */
import type { DsiEntry } from '$lib/types';

/** One turn bracket's folded facts (ADR §6 state homes). */
export interface TurnLifecycle {
	/** Wire: turn/start seq. */
	startSeq: number;
	/** Wire: turn/start time (ms epoch). */
	startMs: number;
	/** Wire: turn/end seq — absent while the turn is in flight. */
	endSeq?: number;
	/** Wire: turn/end time — absent while the turn is in flight. */
	endMs?: number;
	/** Wire: turn/end reason.kind — 'completed' | 'aborted' | 'error'. */
	reasonKind?: string;
	/** Wire: reason.reason.kind when reasonKind is 'aborted' (e.g. 'user'). */
	abortKind?: string;
}

function isLifecycleEntry(entry: DsiEntry): entry is Extract<DsiEntry, { kind: 'turn-lifecycle' }> {
	return entry.kind === 'turn-lifecycle';
}

/**
 * Fold all turn-lifecycle markers into per-turn records keyed by the
 * harness's turn number. Pure; last-write-wins per phase (ledger replays
 * may re-serve a bracket).
 */
export function projectTurnLifecycle(entries: readonly DsiEntry[]): Map<number, TurnLifecycle> {
	const map = new Map<number, TurnLifecycle>();
	for (const entry of entries) {
		if (!isLifecycleEntry(entry)) continue;
		const prev = map.get(entry.turn);
		if (entry.phase === 'start') {
			// A start RESETS the bracket. Replay tolerance: if an end already
			// folded for this turn BEYOND this start's seq (out-of-order
			// delivery), keep it; a stale end inside the new bracket drops.
			const keepEnd = prev?.endSeq !== undefined && prev.endSeq > entry.seq;
			map.set(entry.turn, {
				startSeq: entry.seq,
				startMs: entry.time,
				...(keepEnd ? { endSeq: prev?.endSeq, endMs: prev?.endMs, reasonKind: prev?.reasonKind, abortKind: prev?.abortKind } : {})
			});
		} else {
			const base: TurnLifecycle = prev ?? { startSeq: Number.MAX_SAFE_INTEGER, startMs: entry.time };
			map.set(entry.turn, {
				...base,
				endSeq: entry.seq,
				endMs: entry.time,
				reasonKind: entry.reasonKind,
				...(entry.abortKind !== undefined ? { abortKind: entry.abortKind } : {})
			});
		}
	}
	return map;
}

/**
 * Join a turn group to its lifecycle record: the record must BRACKET the
 * group — start seq strictly before the group's first entry seq, end seq
 * strictly after the group's last entry seq. Unpaired (in-flight or
 * start-less) records never join, so an open turn renders nothing.
 */
export function lifecycleForGroup(
	map: Map<number, TurnLifecycle>,
	firstSeq: number,
	lastSeq: number
): TurnLifecycle | undefined {
	for (const record of map.values()) {
		if (record.startSeq < firstSeq && record.endSeq !== undefined && record.endSeq > lastSeq) {
			return record;
		}
	}
	return undefined;
}
