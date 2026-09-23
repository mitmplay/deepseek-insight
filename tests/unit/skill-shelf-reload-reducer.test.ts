/**
 * The Reload Rememberer's reducer under a FAKE clock (2026-09-23, ADR D2/D5):
 * all four named events from every state, the expiry boundary, the derive,
 * and purity — milliseconds, no real waits, no DOM.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	DONE_WINDOW_MS,
	reduceReload,
	visiblePhase,
	type ReloadFeedback
} from '$lib/utils/skill-shelf-reload-machine';

const T0 = 1_700_000_000_000;

afterEach(() => {
	vi.useRealTimers();
});

describe('reduceReload — the four named events', () => {
	it('reloadStarted from idle begins a machine run at now', () => {
		expect(reduceReload(null, 'reloadStarted', T0)).toEqual({
			phase: 'loading',
			startedAt: T0
		});
	});

	it('reloadStarted mid-run restarts the run (fresh startedAt)', () => {
		const mid: ReloadFeedback = { phase: 'loading', startedAt: T0 };
		expect(reduceReload(mid, 'reloadStarted', T0 + 50)).toEqual({
			phase: 'loading',
			startedAt: T0 + 50
		});
	});

	it('reloadSucceeded sets an ABSOLUTE expiry now plus the window', () => {
		const loading: ReloadFeedback = { phase: 'loading', startedAt: T0 };
		expect(reduceReload(loading, 'reloadSucceeded', T0 + 1_000)).toEqual({
			phase: 'done',
			startedAt: T0,
			doneAt: T0 + 1_000 + DONE_WINDOW_MS
		});
	});

	it('reloadSucceeded from a null state still produces a complete blob', () => {
		expect(reduceReload(null, 'reloadSucceeded', T0)).toEqual({
			phase: 'done',
			startedAt: T0,
			doneAt: T0 + DONE_WINDOW_MS
		});
	});

	it('reloadFailed clears the machine to idle', () => {
		const loading: ReloadFeedback = { phase: 'loading', startedAt: T0 };
		expect(reduceReload(loading, 'reloadFailed', T0 + 1)).toBeNull();
	});

	it('windowExpired clears the machine to idle', () => {
		const done: ReloadFeedback = {
			phase: 'done',
			startedAt: T0,
			doneAt: T0 + DONE_WINDOW_MS
		};
		expect(reduceReload(done, 'windowExpired', T0 + DONE_WINDOW_MS)).toBeNull();
	});
});

describe('visiblePhase — the derive against the clock', () => {
	it('null reads idle', () => {
		expect(visiblePhase(null, T0)).toBe('idle');
	});

	it('loading reads loading regardless of the clock', () => {
		expect(visiblePhase({ phase: 'loading', startedAt: T0 }, T0 + 999_999)).toBe('loading');
	});

	it('done inside its window reads done', () => {
		const done: ReloadFeedback = { phase: 'done', startedAt: T0, doneAt: T0 + 5_000 };
		expect(visiblePhase(done, T0 + 4_999)).toBe('done');
	});

	it('the expiry BOUNDARY is expired — now equal to doneAt reads idle', () => {
		const done: ReloadFeedback = { phase: 'done', startedAt: T0, doneAt: T0 + 5_000 };
		expect(visiblePhase(done, T0 + 5_000)).toBe('idle');
		expect(visiblePhase(done, T0 + 5_001)).toBe('idle');
	});

	it('a done blob WITHOUT a numeric doneAt reads idle (junk-safe)', () => {
		const junk = { phase: 'done', startedAt: T0 } as ReloadFeedback;
		expect(visiblePhase(junk, T0)).toBe('idle');
	});
});

describe('purity — same inputs, same output, no clock of its own', () => {
	it('the reducer never consults the real clock', () => {
		vi.useFakeTimers();
		vi.setSystemTime(T0 + 999_999);
		const loading: ReloadFeedback = { phase: 'loading', startedAt: T0 };
		// an explicit now of 0 must win over the (much later) system time
		expect(reduceReload(loading, 'reloadSucceeded', 0)).toEqual({
			phase: 'done',
			startedAt: T0,
			doneAt: DONE_WINDOW_MS
		});
	});

	it('the reducer does not mutate its input', () => {
		const done: ReloadFeedback = { phase: 'done', startedAt: T0, doneAt: T0 + 1 };
		snapshot(done);
		reduceReload(done, 'windowExpired', T0 + 2);
		expect(done).toEqual({ phase: 'done', startedAt: T0, doneAt: T0 + 1 });
	});

	function snapshot(s: ReloadFeedback): ReloadFeedback {
		return { ...s };
	}
});
