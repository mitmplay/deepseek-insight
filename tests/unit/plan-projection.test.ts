/**
 * plan-projection unit tests — the host's `plan` projection value → the
 * header's plan-mode pill (conservative whole-value read). Wire shape
 * pinned from DSH packages/plan/plan-mode/src/types.ts (PlanProjection:
 * {active: boolean, pending: boolean}).
 */
import { describe, expect, it } from 'vitest';
import { planFromProjection } from '../../src/lib/services/conversation/plan-projection';

describe('planFromProjection', () => {
	it('reads the active/pending pair', () => {
		expect(planFromProjection({ active: true, pending: false })).toEqual({ active: true, pending: false });
		expect(planFromProjection({ active: false, pending: true })).toEqual({ active: false, pending: true });
	});

	it('null/absent/malformed → null (the pill hides)', () => {
		expect(planFromProjection(null)).toBeNull();
		expect(planFromProjection(undefined)).toBeNull();
		expect(planFromProjection('active')).toBeNull();
		expect(planFromProjection({ active: 'yes', pending: false })).toBeNull();
		expect(planFromProjection({ active: true })).toBeNull();
		expect(planFromProjection(['active'])).toBeNull();
	});
});
