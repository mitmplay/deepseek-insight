/**
 * spine-feed tests (W8 task 8.1-T) — the module-scope reactive store
 * behind the floor's spine poll (KB "The Floor Decomposition" E4).
 * Pins the S3/BC-7 lifecycle contract: ref-counted SINGLE timer (N
 * subscribers → one interval; unsubscribe to zero stops it), the degrade
 * rules (failed fetch keeps previous rows), and the invalidation hook.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	refreshSpineFeed,
	resetSpineFeedForTests,
	spineFeed,
	subscribeSpineFeed
} from '$lib/services/conversation/spine-feed.svelte';

function okSpine(title: string): Response {
	return new Response(
		JSON.stringify({ ok: true, sessions: [{ sessionId: 's1', title }], presets: [] }),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	resetSpineFeedForTests();
});

describe('spine-feed — ref-counted timer (8.1-T, S3/BC-7)', () => {
	it('N subscribers → ONE interval; each unsubscribe decrements; the LAST stops it', async () => {
		vi.useFakeTimers();
		const setSpy = vi.spyOn(globalThis, 'setInterval');
		const clearSpy = vi.spyOn(globalThis, 'clearInterval');
		const fetchMock = vi.fn(async () => okSpine('t0'));
		vi.stubGlobal('fetch', fetchMock);

		const off1 = subscribeSpineFeed();
		const off2 = subscribeSpineFeed();
		const off3 = subscribeSpineFeed();
		// Exactly one timer for three subscribers — the single-timer rule.
		expect(setSpy).toHaveBeenCalledTimes(1);

		off1();
		off2();
		expect(clearSpy).not.toHaveBeenCalled(); // one subscriber still holds it
		off3();
		expect(clearSpy).toHaveBeenCalledTimes(1); // the last unsubscribe stops it
	});

	it('ticks load while subscribed and stop after the last unsubscribe', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		let n = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => okSpine('t' + n++))
		);
		const off = subscribeSpineFeed();
		await vi.advanceTimersByTimeAsync(10);
		expect(spineFeed.rows[0]?.title).toBe('t0');
		await vi.advanceTimersByTimeAsync(10_000);
		expect(spineFeed.rows[0]?.title).not.toBe('t0'); // ticks ran
		off();
		resetSpineFeedForTests();
		const before = spineFeed.rows.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(spineFeed.rows.length).toBe(before); // no ticks after teardown
	});
});

describe('spine-feed — degrade + invalidation (8.1-T)', () => {
	it('a failed fetch keeps the PREVIOUS rows (cold-title fallback posture)', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		let fail = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				if (fail) return new Response('down', { status: 500 });
				return okSpine('good');
			})
		);
		const off = subscribeSpineFeed();
		await vi.advanceTimersByTimeAsync(20);
		expect(spineFeed.rows[0]?.title).toBe('good');
		fail = true;
		await vi.advanceTimersByTimeAsync(20_000);
		expect(spineFeed.rows[0]?.title).toBe('good'); // kept
		off();
	});

	it('refreshSpineFeed loads immediately, outside the cadence', async () => {
		vi.useFakeTimers();
		let loads = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				loads += 1;
				return okSpine('r');
			})
		);
		const off = subscribeSpineFeed();
		expect(loads).toBeGreaterThanOrEqual(1); // the immediate subscribe load
		const before = loads;
		refreshSpineFeed();
		expect(loads).toBe(before + 1); // the hook fired, no timer advanced
		off();
	});
});
