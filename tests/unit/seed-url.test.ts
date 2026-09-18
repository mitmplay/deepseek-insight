/**
 * Unit: seed-url — the ONE conversation seed-link shaper (profile
 * convention, 2026-08-24): sessionKey is a one-shot seed param; profile
 * is sticky and selects the localStorage desk. %20 encoding (not `+`)
 * matches every existing href assertion.
 */
import { describe, expect, it } from 'vitest';
import { conversationSeedUrl } from '$lib/utils/seed-url';

describe('conversationSeedUrl', () => {
	it('default desk: sessionKey only', () => {
		expect(conversationSeedUrl('s-1')).toBe('/?sessionKey=s-1');
	});

	it('profile desk: sessionKey + profile', () => {
		expect(conversationSeedUrl('s-1', 'widi')).toBe('/?sessionKey=s-1&profile=widi');
	});

	it('encodes ids as %20 (URLSearchParams `+` would break href assertions)', () => {
		expect(conversationSeedUrl('abc 123')).toBe('/?sessionKey=abc%20123');
	});
});
