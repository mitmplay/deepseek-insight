import { describe, expect, it } from 'vitest';
import { relativeTime } from '$lib/utils/time';

describe('relativeTime', () => {
	const now = 1_800_000_000_000; // fixed clock

	it('returns "just now" under 10 seconds', () => {
		expect(relativeTime(now - 5_000, now)).toBe('just now');
	});

	it('formats seconds', () => {
		expect(relativeTime(now - 45_000, now)).toBe('45s ago');
	});

	it('formats minutes', () => {
		expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
	});

	it('formats hours', () => {
		expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
	});

	it('formats days up to 6', () => {
		expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
	});

	it('clamps future timestamps to "just now"', () => {
		expect(relativeTime(now + 30_000, now)).toBe('just now');
	});

	it('falls back to YYYY-MM-DD after a week', () => {
		expect(relativeTime(now - 8 * 86_400_000, now)).toBe('2027-01-07');
	});
});
