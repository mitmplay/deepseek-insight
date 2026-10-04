/**
 * dsh-events-usage — The Exact Total (ADR-0012, tasks 1.1-T / 1.2-T).
 *
 * usageOf is private; these tests drive it through the exported seam
 * entryForEvent, so the fixture is the real wire shape of an
 * assistant/message event. The exact total (totalTokens) is copied
 * verbatim when it is a safe positive count and dropped otherwise —
 * DSI is a copier of the host-validated figure, never a synthesizer.
 */
import { describe, expect, it } from 'vitest';
import { entryForEvent, type DshRawEvent } from '$lib/services/conversation/dsh-events';

const msg = (usage: Record<string, unknown> | undefined): DshRawEvent => ({
	type: 'assistant/message',
	seq: 1,
	time: 1000,
	data: {
		turn: 1,
		step: 1,
		message: { content: [{ type: 'text', text: 'hi' }], source: { provider: 'zai', model: 'glm-5.3-flash' } },
		...(usage === undefined ? {} : { usage })
	}
}) as unknown as DshRawEvent;

const usageOf = (event: DshRawEvent) => {
	const entry = entryForEvent(event);
	return entry !== null && entry.kind === 'assistant-message' ? entry.usage : undefined;
};

describe('usageOf — the exact total (ADR-0012 D1)', () => {
	it('carries totalTokens when the wire reports a safe positive count', () => {
		const u = usageOf(msg({ inputTokens: 11302, outputTokens: 205, totalTokens: 22259 }));
		expect(u?.totalTokens).toBe(22259);
		expect(u?.provider).toBe('zai');
	});

	it('drops the field when the wire does not report it (pre-ADR ledgers)', () => {
		const u = usageOf(msg({ inputTokens: 10, outputTokens: 2 }));
		expect(u).toBeDefined();
		expect(u && 'totalTokens' in u).toBe(false);
	});

	it('declines junk totals: zero, negative, fractional, non-numeric', () => {
		for (const bad of [0, -5, 1.5, '22259', null]) {
			const u = usageOf(msg({ inputTokens: 10, outputTokens: 2, totalTokens: bad }));
			expect(u && 'totalTokens' in u, String(bad)).toBe(false);
		}
	});

	it('still declines the whole record when input/output are missing', () => {
		expect(usageOf(msg({ totalTokens: 22259 }))).toBeUndefined();
	});
});
