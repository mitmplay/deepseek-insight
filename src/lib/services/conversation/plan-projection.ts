/**
 * plan-projection — the host's plan-mode state, read from the
 * session/control projection stream (the permission-state seam: same
 * block, pure mapping — no I/O, no Svelte). The host folds the plan
 * command lifecycle and `plan/mode` events into the `plan` projection
 * (packages/plan/plan-mode/src/types.ts PlanProjection): `active` is the
 * logged state in force, `pending` true while a /plan selection has not
 * yet confirmed through its paired command lifecycle.
 *
 * Read state (mirrors imageLimits' contract): the value arrives whole or
 * not at all — anything absent/malformed reads as null (no indicator;
 * the header chip simply hides). Capability absence (plan-mode not
 * composed) is the KEY's absence, never a value.
 */

export interface DsiPlanProjection {
	/** The logged plan-mode state in force. */
	active: boolean;
	/** True while a /plan selection targets a state other than `active`
	 *  and has not yet confirmed. */
	pending: boolean;
}

/**
 * Validate the projections block's plan value.
 *
 * @param raw - the projection value (projections.values.plan), untyped.
 * @returns the {active, pending} pair, or null when absent/malformed —
 * the caller then hides the indicator.
 */
export function planFromProjection(raw: unknown): DsiPlanProjection | null {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const value = raw as Record<string, unknown>;
	if (typeof value.active !== 'boolean' || typeof value.pending !== 'boolean') return null;
	return { active: value.active, pending: value.pending };
}
