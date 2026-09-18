/**
 * goal-projection unit tests — the host's `goal` projection value → the
 * GoalBar readout (three-state read: undefined = key not delivered,
 * null = no goal, object = validated goal). Wire shape pinned 2026-09-08
 * from DSH packages/goal/goal/src/types.ts GoalProjection:
 * { goal: GoalSnapshot, roundsStarted, createdAt, updatedAt } | null.
 */
import { describe, expect, it } from 'vitest';
import { goalFromProjection } from '../../src/lib/services/conversation/goal-projection';

const snapshot = {
	id: 'goal-1',
	revision: 3,
	objective: 'finish the wave',
	phase: 'active',
	maxGoalRounds: 8
} as const;

const projection = {
	goal: snapshot,
	roundsStarted: 2,
	createdAt: 1_000,
	updatedAt: 2_000
};

describe('goalFromProjection', () => {
	it('undefined input → undefined (key not delivered — caller keeps current)', () => {
		expect(goalFromProjection(undefined)).toBeUndefined();
	});

	it('null → null (the host has no goal — pre-create or clear tombstone)', () => {
		expect(goalFromProjection(null)).toBeNull();
	});

	it('a valid projection value normalizes to GoalResultGoal (bookkeeping dropped)', () => {
		expect(goalFromProjection(projection)).toEqual({
			id: 'goal-1',
			revision: 3,
			objective: 'finish the wave',
			phase: 'active',
			roundsStarted: 2,
			maxGoalRounds: 8
		});
	});

	it('a blocked snapshot carries its blockedReason', () => {
		const blocked = {
			...projection,
			goal: { ...snapshot, phase: 'blocked', blockedReason: { code: 'min-rounds', message: 'waiting' } }
		};
		expect(goalFromProjection(blocked)).toEqual({
			id: 'goal-1',
			revision: 3,
			objective: 'finish the wave',
			phase: 'blocked',
			roundsStarted: 2,
			maxGoalRounds: 8,
			blockedReason: { code: 'min-rounds', message: 'waiting' }
		});
	});

	it('missing / bad phase → null', () => {
		expect(goalFromProjection({ ...projection, goal: { ...snapshot, phase: 'paused' } })).toMatchObject({ phase: 'paused' });
		expect(goalFromProjection({ ...projection, goal: { ...snapshot, phase: 'running' } })).toBeNull();
		expect(goalFromProjection({ ...projection, goal: { ...snapshot, phase: undefined } })).toBeNull();
	});

	it('missing id / objective → null', () => {
		expect(goalFromProjection({ ...projection, goal: { ...snapshot, id: '' } })).toBeNull();
		expect(goalFromProjection({ ...projection, goal: { ...snapshot, id: undefined } })).toBeNull();
		expect(goalFromProjection({ ...projection, goal: { ...snapshot, objective: '' } })).toBeNull();
	});

	it('a malformed blockedReason → null (never a half-parsed reason)', () => {
		expect(
			goalFromProjection({ ...projection, goal: { ...snapshot, phase: 'blocked', blockedReason: { code: 1 } } })
		).toBeNull();
		expect(
			goalFromProjection({ ...projection, goal: { ...snapshot, phase: 'blocked', blockedReason: 'waiting' } })
		).toBeNull();
	});

	it('a projection whose goal member is not an object → null', () => {
		expect(goalFromProjection({ goal: null, roundsStarted: 0 })).toBeNull();
		expect(goalFromProjection({ goal: 'goal-1', roundsStarted: 0 })).toBeNull();
		expect(goalFromProjection({ roundsStarted: 0 })).toBeNull();
	});

	it('non-object / array / primitive values → null', () => {
		expect(goalFromProjection([])).toBeNull();
		expect(goalFromProjection([projection])).toBeNull();
		expect(goalFromProjection('active')).toBeNull();
		expect(goalFromProjection(42)).toBeNull();
	});

	it('missing numeric fields default to 0, never throw', () => {
		const bare = { id: 'goal-1', objective: 'finish the wave', phase: 'active' } as const;
		expect(goalFromProjection({ goal: bare })).toEqual({
			id: 'goal-1',
			revision: 0,
			objective: 'finish the wave',
			phase: 'active',
			roundsStarted: 0,
			maxGoalRounds: 0
		});
	});

	it('never throws over junk inputs', () => {
		for (const junk of [NaN, () => {}, Symbol('x'), true, { goal: { phase: {} } }, { goal: [] }, { toJSON: null }]) {
			expect(() => goalFromProjection(junk)).not.toThrow();
		}
	});
});
