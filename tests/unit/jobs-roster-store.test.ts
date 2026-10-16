/**
 * Roster store (Job Badge Wave 1, Task 1.4-T; cadence re-homed by the
 * Roster Mirror wave, ADR 2026-10-17 / BC-7) — the refcount contract:
 * first watch fetches immediately; extra watches are free; last unwatch
 * drops the set and refreshWatched() stops touching it; a refresh
 * REPLACES the set; a failed refresh keeps the last known set (never
 * blanks). The store owns NO client timer — the page's spine tick drives
 * refreshWatched(); no mount may schedule an setInterval.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fresh module per test: the singleton's Map must not leak watchers.
async function fresh() {
	vi.resetModules();
	return await import('../../src/lib/services/jobs/roster-store.svelte.ts');
}

const job = (id: string, status: string) => ({
	id,
	kind: 'bash',
	label: 'job ' + id,
	status,
	startedAt: 1,
	output: { total: 0, earliest: 0 }
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.useFakeTimers();
	fetchMock = vi.fn(async (url: string | URL | Request) => {
		const sessionId = new URL(String(url), 'http://localhost').searchParams.get('sessionId');
		return {
			ok: true,
			json: async () => ({
				ok: true,
				sessionId,
				jobs: sessionId === 'conv-1' ? [job('bash-1', 'running')] : []
			})
		};
	});
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('jobs roster store', () => {
	it('first watch fetches immediately; the frame REPLACES the set', async () => {
		const { jobsRoster } = await fresh();
		jobsRoster.watch('conv-1');
		await vi.advanceTimersByTimeAsync(0);
		expect(jobsRoster.jobs('conv-1')).toHaveLength(1);
		expect(jobsRoster.liveCount('conv-1')).toBe(1);
	});

	it('refreshWatched refetches watched sessions — the page-owned spine tick piggyback', async () => {
		const { jobsRoster } = await fresh();
		jobsRoster.watch('conv-1');
		await vi.advanceTimersByTimeAsync(0);
		const before = fetchMock.mock.calls.length;
		jobsRoster.refreshWatched();
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock.mock.calls.length).toBe(before + 1); // one tick, one snapshot
	});

	it('extra watches refcount — one tick fetch, last unwatch clears', async () => {
		const { jobsRoster } = await fresh();
		jobsRoster.watch('conv-1');
		jobsRoster.watch('conv-1');
		await vi.advanceTimersByTimeAsync(0);
		const withTwo = fetchMock.mock.calls.length;
		jobsRoster.refreshWatched();
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock.mock.calls.length - withTwo).toBe(1); // one fetch despite two watchers
		jobsRoster.unwatch('conv-1');
		const afterFirst = fetchMock.mock.calls.length;
		jobsRoster.refreshWatched();
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock.mock.calls.length - afterFirst).toBe(1); // still one watcher: refreshes on
		jobsRoster.unwatch('conv-1');
		expect(jobsRoster.jobs('conv-1')).toEqual([]); // dropped at zero
		const before = fetchMock.mock.calls.length;
		jobsRoster.refreshWatched();
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock.mock.calls.length - before).toBe(0); // nothing watched: tick fetches nowhere
	});

	it('a failed poll keeps the last known set — never blanks on error', async () => {
		const { jobsRoster } = await fresh();
		jobsRoster.watch('conv-1');
		await vi.advanceTimersByTimeAsync(0);
		expect(jobsRoster.jobs('conv-1')).toHaveLength(1);
		fetchMock.mockRejectedValue(new Error('network down'));
		await jobsRoster.refresh('conv-1'); // the tick's fetch fails…
		expect(jobsRoster.jobs('conv-1')).toHaveLength(1); // …the set survives
	});

	it('unwatched sessions read empty and never fetch', async () => {
		const { jobsRoster } = await fresh();
		expect(jobsRoster.jobs('conv-9')).toEqual([]);
		jobsRoster.unwatch('conv-9'); // no-op on an unknown session
		jobsRoster.refreshWatched(); // a tick with zero watchers fetches nothing
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('schedules ZERO setInterval — the page owns the spine cadence (BC-7)', async () => {
		const intervals = vi.fn(() => 0);
		vi.stubGlobal('setInterval', intervals);
		const { jobsRoster } = await fresh();
		jobsRoster.watch('conv-1');
		await vi.advanceTimersByTimeAsync(0);
		expect(intervals).not.toHaveBeenCalled();
	});
});
