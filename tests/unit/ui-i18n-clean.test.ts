/**
 * Repo-scan gate — Three Tongues W3 task 3.4-T (ADR 2026-09-12 D4).
 * Pins the end state: ZERO raw-copy violations in svelte sources at HEAD.
 * (3.2-T/3.3-T behavior coverage rides the existing host suites, which
 * render the migrated components through their real m.* calls.)
 */
import { describe, it, expect } from 'vitest';
import { verify } from '../../scripts/verify-ui-i18n';

describe('verify-ui-i18n repo scan (3.4-T)', () => {
	it('zero violations at HEAD — components do not own copy', () => {
		const violations = verify();
		expect(violations, JSON.stringify(violations.slice(0, 10), null, 1)).toEqual([]);
	});
});
