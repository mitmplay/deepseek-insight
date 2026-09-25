/**
 * turn-projection unit tests — Turn End Stamp (ADR 2026-09-25, tasks 1.2/1.2-T).
 * Marker wire shapes mirror tests/unit/dsh-events.test.ts (session 47a4c492).
 */
import { describe, expect, it } from 'vitest';
import type { DsiEntry } from '$lib/types';
import { lifecycleForGroup, projectTurnLifecycle } from '$lib/services/conversation/turn-projection';

/** Explicit seq: adjacency IS the joiner's contract, fixtures pin it. */
function marker(turn: number, phase: 'start' | 'end', time: number, extra: { reasonKind?: string; abortKind?: string } = {}, s = 0): DsiEntry {
	return {
		kind: 'turn-lifecycle',
		id: `tl:${turn}:${phase}`,
		seq: s,
		time,
		turn,
		phase,
		...(extra.reasonKind !== undefined ? { reasonKind: extra.reasonKind } : {}),
		...(extra.abortKind !== undefined ? { abortKind: extra.abortKind } : {})
	} as DsiEntry;
}
function entry(s: number): DsiEntry {
	return { kind: 'unknown-event', id: `ev:${s}`, seq: s, time: 0, eventType: 'x' };
}

describe('projectTurnLifecycle', () => {
	it('folds a completed pair into one record', () => {
		const map = projectTurnLifecycle([marker(7, 'start', 1000, {}, 1), marker(7, 'end', 2000, { reasonKind: 'completed' }, 2)]);
		expect(map.get(7)).toMatchObject({ startSeq: 1, startMs: 1000, endSeq: 2, endMs: 2000, reasonKind: 'completed' });
	});

	it('preserves aborted(user) reason and abort kind', () => {
		const map = projectTurnLifecycle([marker(9, 'start', 1000, {}, 1), marker(9, 'end', 2000, { reasonKind: 'aborted', abortKind: 'user' }, 2)]);
		expect(map.get(9)).toMatchObject({ reasonKind: 'aborted', abortKind: 'user' });
	});

	it('an end without a start still folds (start-less ledger degradation)', () => {
		const map = projectTurnLifecycle([marker(3, 'end', 2000, { reasonKind: 'completed' }, 1)]);
		expect(map.get(3)?.endMs).toBe(2000);
	});

	it('a second start resets the bracket and drops a stale end inside it', () => {
		const map = projectTurnLifecycle([
			marker(1, 'start', 100),
			marker(1, 'end', 150, { reasonKind: 'completed' }),
			marker(1, 'start', 200)
		]);
		const r = map.get(1)!;
		expect(r.startMs).toBe(200);
		expect(r.endSeq).toBeUndefined();
	});
});

describe('lifecycleForGroup — realistic orderings', () => {
	it('bracketing pair joins its group', () => {
		const entries = [
			marker(7, 'start', 1000, {}, 1),
			entry(2),
			entry(3),
			marker(7, 'end', 2000, { reasonKind: 'completed' }, 4)
		];
		const map = projectTurnLifecycle(entries);
		expect(lifecycleForGroup(map, 2, 3)).toMatchObject({ reasonKind: 'completed' });
	});

	it('does NOT join when the end precedes the group (unpaired / in flight)', () => {
		const entries = [
			marker(8, 'start', 1000, {}, 1),
			entry(2),
			entry(3)
			// no end yet — in-flight turn
		];
		const map = projectTurnLifecycle(entries);
		expect(lifecycleForGroup(map, 2, 3)).toBeUndefined();
	});

	it('does NOT join when the group starts before the bracket (markers after group)', () => {
		const entries = [
			entry(1),
			entry(2),
			marker(9, 'start', 1000, {}, 3),
			entry(4),
			marker(9, 'end', 2000, { reasonKind: 'completed' }, 5)
		];
		const map = projectTurnLifecycle(entries);
		// group 1..2: start seq 3 is NOT < 1 → no join
		expect(lifecycleForGroup(map, 1, 2)).toBeUndefined();
		// the bracketed group joins
		expect(lifecycleForGroup(map, 4, 4)).toMatchObject({ reasonKind: 'completed' });
	});

	it('empty projection (old ledgers) never joins', () => {
		expect(lifecycleForGroup(projectTurnLifecycle([entry(1), entry(2)]), 1, 2)).toBeUndefined();
	});
});
