/**
 * goal-projection — the session's CURRENT goal, read from the
 * session/control projection stream (the permission-state seam: same
 * block, pure mapping — no I/O, no Svelte). The host folds the durable
 * `goal/change` lifecycle into the `goal` projection key
 * (packages/goal/goal/src/types.ts: `SessionProjectionMap.goal`).
 *
 * Pinned wire value (probed 2026-09-08 from DSH
 * packages/goal/goal/src/types.ts GoalProjection): `GoalProjection | null`
 *
 *     { goal: { id, revision, objective, phase, blockedReason?,
 *               maxGoalRounds },
 *       roundsStarted, createdAt, updatedAt }
 *
 * — NOT the tool-result compact value {goal, activation}: activation is
 * process-local and deliberately absent from the projection. This reader
 * normalizes the projection shape onto GoalResultGoal (the shared shape
 * from $lib/utils/goals.ts) at this one seam.
 *
 * Three-state read (mirrors todo-projection.ts):
 *   undefined — the projection key was never delivered (caller keeps
 *               whatever it already shows; absent ≠ no goal)
 *   null      — the host says there is NO goal (pre-first-create or the
 *               clear tombstone) — the caller hides the bar
 *   object    — the validated current goal; a malformed value reads as
 *               null (the bar simply hides), never throws
 */

import type { GoalResultGoal, GoalPhase } from '$lib/utils/goals';

const PHASES: ReadonlySet<string> = new Set(['active', 'paused', 'blocked', 'complete']);

/**
 * Validate the projections block's goal value.
 *
 * @param raw - the projection value (projections.values.goal), untyped.
 * @returns undefined when the key is absent (not delivered), null when the
 * host has no current goal (or the value is malformed), else the validated
 * goal — createdAt/updatedAt are host bookkeeping and are dropped; every
 * GoalResultGoal field the UI renders is required and validated.
 */
export function goalFromProjection(raw: unknown): GoalResultGoal | null | undefined {
	if (raw === undefined) return undefined;
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const value = raw as Record<string, unknown>;
	const g = value.goal;
	if (g === null || typeof g !== 'object' || Array.isArray(g)) return null;
	const o = g as Record<string, unknown>;
	if (typeof o.id !== 'string' || o.id.length === 0) return null;
	if (typeof o.objective !== 'string' || o.objective.length === 0) return null;
	if (typeof o.phase !== 'string' || !PHASES.has(o.phase)) return null;
	const reason = o.blockedReason;
	const reasonOk =
		reason === undefined ||
		(reason !== null &&
			typeof reason === 'object' &&
			typeof (reason as Record<string, unknown>).code === 'string' &&
			typeof (reason as Record<string, unknown>).message === 'string');
	if (!reasonOk) return null;
	return {
		id: o.id,
		revision: typeof o.revision === 'number' ? o.revision : 0,
		objective: o.objective,
		phase: o.phase as GoalPhase,
		roundsStarted: typeof value.roundsStarted === 'number' ? value.roundsStarted : 0,
		maxGoalRounds: typeof o.maxGoalRounds === 'number' ? o.maxGoalRounds : 0,
		...(reason !== undefined
			? {
					blockedReason: {
						code: (reason as Record<string, unknown>).code as string,
						message: (reason as Record<string, unknown>).message as string
					}
				}
			: {})
	};
}
