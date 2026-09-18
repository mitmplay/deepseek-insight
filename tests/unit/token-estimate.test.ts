/**
 * estimateTokens tests (OCI port parity, 2026-08-23): ~4 chars/token
 * heuristic — 0 for empty/null/undefined, ceil otherwise.
 */
import { describe, expect, it } from 'vitest';
import { estimateTokens } from '$lib/utils/token-estimate';

describe('estimateTokens', () => {
	it('empty string → 0', () => {
		expect(estimateTokens('')).toBe(0);
	});
	it('null → 0', () => {
		expect(estimateTokens(null)).toBe(0);
	});
	it('undefined → 0', () => {
		expect(estimateTokens(undefined)).toBe(0);
	});
	it('short strings round up to 1', () => {
		expect(estimateTokens('hi')).toBe(1);
		expect(estimateTokens('abc')).toBe(1);
	});
	it('ceils past the 4-char boundary', () => {
		expect(estimateTokens('abcd')).toBe(1);
		expect(estimateTokens('abcde')).toBe(2);
	});
	it('long text scales with length', () => {
		expect(estimateTokens('a'.repeat(400))).toBe(100);
	});
});
