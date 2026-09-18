/**
 * goals.ts unit tests — the goal tool family's ONE parser: family
 * detection (_goal suffix), args/result parsing against wire shapes
 * pinned from DSH tool-goal, junk honesty (undefined, never throws,
 * never a half-shape), and the card title verb mapping.
 */

import { describe, expect, it } from 'vitest';
import { goalVerb, isGoalTool, parseGoalArgs, parseGoalResult } from '$lib/utils/goals';

describe('isGoalTool — the family is the _goal suffix', () => {
	it('matches the three wire tools and any future _goal member', () => {
		expect(isGoalTool('get_goal')).toBe(true);
		expect(isGoalTool('create_goal')).toBe(true);
		expect(isGoalTool('update_goal')).toBe(true);
		expect(isGoalTool('future_goal')).toBe(true);
	});

	it('rejects non-family names', () => {
		expect(isGoalTool('goal')).toBe(false);
		expect(isGoalTool('bash')).toBe(false);
		expect(isGoalTool('')).toBe(false);
	});
});

describe('parseGoalArgs', () => {
	it('parses create args (objective + cap)', () => {
		expect(parseGoalArgs('{"objective":"Fix the row","max_goal_rounds":8}')).toEqual({
			objective: 'Fix the row',
			max_goal_rounds: 8
		});
	});

	it('parses update args (ref + action) and drops unknown action values', () => {
		expect(
			parseGoalArgs('{"goal_id":"goal-x","revision":2,"action":"complete"}')
		).toEqual({ goal_id: 'goal-x', revision: 2, action: 'complete' });
		expect(parseGoalArgs('{"goal_id":"goal-x","action":"nuke"}')).toEqual({ goal_id: 'goal-x' });
	});

	it('get_goal empty args and junk parse to undefined', () => {
		expect(parseGoalArgs('{}')).toBeUndefined();
		expect(parseGoalArgs(undefined)).toBeUndefined();
		expect(parseGoalArgs('{not json')).toBeUndefined();
		expect(parseGoalArgs('"text"')).toBeUndefined();
		expect(parseGoalArgs('[1]')).toBeUndefined();
	});
});

describe('parseGoalResult', () => {
	it('parses the compact goal value (session-85d8e67c wire shape)', () => {
		const text = JSON.stringify({
			goal: {
				id: 'goal-05e8d12e-7334-4580-b5f9-44c959e17c91',
				revision: 2,
				objective: 'Fix the filter row',
				phase: 'active',
				roundsStarted: 0,
				maxGoalRounds: 8
			},
			activation: 'disarmed'
		});
		expect(parseGoalResult(text)).toEqual({
			goal: {
				id: 'goal-05e8d12e-7334-4580-b5f9-44c959e17c91',
				revision: 2,
				objective: 'Fix the filter row',
				phase: 'active',
				roundsStarted: 0,
				maxGoalRounds: 8
			},
			activation: 'disarmed'
		});
	});

	it('parses blockedReason and keeps unknown activation out', () => {
		const text = JSON.stringify({
			goal: {
				id: 'g',
				revision: 4,
				objective: 'o',
				phase: 'blocked',
				blockedReason: { code: 'NO_KEY', message: 'missing key' }
			},
			activation: 'maybe'
		});
		expect(parseGoalResult(text)).toEqual({
			goal: {
				id: 'g',
				revision: 4,
				objective: 'o',
				phase: 'blocked',
				roundsStarted: 0,
				maxGoalRounds: 0,
				blockedReason: { code: 'NO_KEY', message: 'missing key' }
			}
		});
	});

	it('parses {"goal":null} — no current goal is a real state', () => {
		expect(parseGoalResult('{"goal":null}')).toEqual({ goal: null });
	});

	it('junk and non-goal shapes parse to undefined', () => {
		expect(parseGoalResult(undefined)).toBeUndefined();
		expect(parseGoalResult('{not json')).toBeUndefined();
		expect(parseGoalResult('{"answers":[]}')).toBeUndefined();
		expect(parseGoalResult('{"goal":"yes"}')).toBeUndefined();
		expect(parseGoalResult('{"goal":{"id":"g","objective":"o","phase":"weird"}}')).toBeUndefined();
	});
});

describe('goalVerb — card title mapping', () => {
	it('create/get are fixed; update follows the action', () => {
		expect(goalVerb('create_goal')).toBe('created');
		expect(goalVerb('get_goal')).toBeUndefined();
		expect(goalVerb('update_goal', 'edit')).toBe('edited');
		expect(goalVerb('update_goal', 'pause')).toBe('paused');
		expect(goalVerb('update_goal', 'resume')).toBe('resumed');
		expect(goalVerb('update_goal', 'complete')).toBe('completed');
		expect(goalVerb('update_goal', 'blocked')).toBe('blocked');
		expect(goalVerb('update_goal')).toBe('updated');
		expect(goalVerb('other_goal')).toBeUndefined();
	});
});
