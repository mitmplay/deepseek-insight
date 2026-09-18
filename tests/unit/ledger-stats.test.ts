/**
 * ledger-stats mapper tests: the host sessionStats + tokenUsage projection
 * pair validates field-by-field; any miss degrades to null (the panel keeps
 * its partial fold) — never a partial guess.
 */
import { describe, expect, it } from 'vitest';
import { ledgerStatsFromProjections } from '$lib/services/conversation/ledger-stats';

const sessionStats = {
	turns: 20,
	steps: 286,
	llmMs: 4_210_000,
	toolMs: 1_451_000,
	ttftMs: 448_000,
	ttftSteps: 286,
	decodeMs: 1_930_000,
	decodeTokens: 108_000
};

const tokenUsage = {
	uncachedInputTokens: 615_000,
	outputTokens: 108_000,
	cacheReadTokens: 60_800_000,
	cacheWriteTokens: 0
};

describe('ledgerStatsFromProjections', () => {
	it('validates and merges the whole-log pair', () => {
		expect(ledgerStatsFromProjections(sessionStats, tokenUsage)).toEqual({
			turns: 20,
			steps: 286,
			llmMs: 4_210_000,
			toolMs: 1_451_000,
			ttftMs: 448_000,
			ttftSteps: 286,
			decodeMs: 1_930_000,
			decodeTokens: 108_000,
			uncachedInputTokens: 615_000,
			cacheReadTokens: 60_800_000,
			cacheWriteTokens: 0,
			outputTokens: 108_000
		});
	});

	it('reads tokenUsage as the FLAT wire value (no totals wrapper)', () => {
		// The persisted fold state wraps its totals; the projection stream
		// value does not — a totals-wrapped body must NOT validate.
		expect(ledgerStatsFromProjections(sessionStats, { totals: tokenUsage })).toBeNull();
	});

	it('returns null when either projection is absent or malformed', () => {
		expect(ledgerStatsFromProjections(undefined, tokenUsage)).toBeNull();
		expect(ledgerStatsFromProjections(sessionStats, undefined)).toBeNull();
		expect(ledgerStatsFromProjections(null, tokenUsage)).toBeNull();
		expect(ledgerStatsFromProjections('nope', tokenUsage)).toBeNull();
		expect(ledgerStatsFromProjections({ ...sessionStats, steps: -1 }, tokenUsage)).toBeNull();
		expect(ledgerStatsFromProjections({ ...sessionStats, llmMs: 'many' }, tokenUsage)).toBeNull();
		expect(ledgerStatsFromProjections(sessionStats, { ...tokenUsage, outputTokens: -5 })).toBeNull();
		expect(ledgerStatsFromProjections(sessionStats, [tokenUsage])).toBeNull();
	});
});
