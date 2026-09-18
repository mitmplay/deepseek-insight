import { describe, expect, it } from 'vitest';
import { deriveSessionStats, type SessionStats } from '../../src/lib/services/conversation/session-stats';
import type { DsiEntry } from '../../src/lib/types';

/** Fixture builders — minimal entries carrying only the fields the fold reads. */
function user(text: string): DsiEntry {
	return { kind: 'user-message', id: `u:${text}`, seq: 0, time: 0, text };
}
function assistant(usage?: {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
}): DsiEntry {
	return {
		kind: 'assistant-message',
		id: `a:${Math.random()}`,
		seq: 0,
		time: 0,
		text: 'reply',
		streaming: false,
		...(usage ? { usage } : {})
	};
}
function toolResult(durationMs?: number): DsiEntry {
	return {
		kind: 'tool-result',
		id: `t:${Math.random()}`,
		seq: 0,
		time: 0,
		callId: `c:${Math.random()}`,
		toolName: 'bash',
		ok: true,
		...(durationMs !== undefined ? { durationMs } : {})
	};
}

describe('deriveSessionStats', () => {
	it('returns null on an empty stream and on a stream with no assistant message (AC1, D5 gate)', () => {
		expect(deriveSessionStats([])).toBeNull();
		expect(deriveSessionStats([user('hello'), toolResult(100)])).toBeNull();
	});

	it('counts normal user bubbles as turns and injected chips as not-turns', () => {
		const stats = deriveSessionStats([
			user('one'),
			user('two'),
			{ kind: 'user-message', id: 'chip', seq: 0, time: 0, text: 'ctx', meta: 'runtime-context' },
			assistant()
		]);
		expect(stats).toMatchObject({ turns: 2, steps: 1 });
	});

	it('sums tool result durationMs exactly — no double counting, no gap filling (AC4)', () => {
		const stats = deriveSessionStats([user('go'), assistant(), toolResult(1_000), toolResult(2_500), toolResult()]);
		expect(stats?.toolMs).toBe(3_500);
	});

	it('sums usage across assistant messages and omits token fields when no usage exists (D3)', () => {
		const none = deriveSessionStats([user('go'), assistant()]);
		expect(none).not.toHaveProperty('inputTokens');
		expect(none).not.toHaveProperty('cacheHitPercent');

		const some = deriveSessionStats([
			assistant({ inputTokens: 100, outputTokens: 10 }),
			assistant({ inputTokens: 50, outputTokens: 5, cacheReadTokens: 850 })
		]);
		expect(some).toMatchObject({ inputTokens: 150, outputTokens: 15, cacheReadTokens: 850 });
	});

	it('computes cache hit as cacheRead over uncached input plus cache read plus cache write, rounded', () => {
		// 850 cached read of a 100 + 850 + 50 = 1000 total input -> 85 percent.
		const stats: SessionStats = deriveSessionStats([
			assistant({ inputTokens: 100, outputTokens: 1, cacheReadTokens: 850, cacheWriteTokens: 50 })
		])!;
		expect(stats.cacheHitPercent).toBe(85);
		// Zero total input (usage with 0/0/0) -> no cache segment, no divide by zero.
		const zero = deriveSessionStats([assistant({ inputTokens: 0, outputTokens: 0 })])!;
		expect(zero.cacheHitPercent).toBeUndefined();
		expect(zero.inputTokens).toBe(0);
	});

	it('ignores unknown-event and other non-message entries', () => {
		const stats = deriveSessionStats([
			{ kind: 'unknown-event', id: 'ev:1', seq: 1, time: 0, eventType: 'future/thing' },
			{ kind: 'turn-error', id: 'e:1', seq: 2, time: 0, message: 'boom' },
			assistant()
		]);
		expect(stats).toMatchObject({ turns: 0, steps: 1, toolMs: 0 });
	});

	it('grows monotonically for a mid-stream partial stream (streaming assistant message counts as a step)', () => {
		const partial = deriveSessionStats([user('go'), assistant()])!;
		const fuller = deriveSessionStats([user('go'), assistant(), assistant({ inputTokens: 10, outputTokens: 1 }), toolResult(5)])!;
		expect(fuller.steps).toBeGreaterThan(partial.steps);
		expect(fuller.toolMs).toBe(5);
	});
});
