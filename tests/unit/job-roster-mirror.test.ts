import { describe, expect, it, vi } from 'vitest';

import { RpcRelay } from '$lib/server/connection/rpc-relay';
import type { DshConnection } from '$lib/server/dsh-connection';

/**
 * The Roster Mirror unit contract (ADR 2026-10-17 D1-D3, Tasks 1.1-T):
 * cache fill from stream items, honest pending before the first frame,
 * poll-liveness open/close, and the D3 first-failure-only log.
 */

function makeRelay() {
	const logs: unknown[][] = [];
	const relay = new RpcRelay({ log: (...a: unknown[]) => logs.push(a) } as unknown as DshConnection, () => 10, {
		answerReapGraceMs: 1_000,
		staleGenerationRetryMs: 1_000
	});
	const opens: string[] = [];
	const closes: string[] = [];
	relay.wireJobRosterTransport({
		open: (sessionId) => opens.push(sessionId),
		close: (sessionId) => closes.push(sessionId)
	});
	return { relay, logs, opens, closes };
}

describe('roster mirror (ADR 2026-10-17 D1)', () => {
	it('answers pending before any frame arrives', () => {
		const { relay } = makeRelay();
		expect(relay.jobRosterSnapshot('s1')).toEqual({ jobs: [], pending: true });
	});

	it('caches a whole-set item and fans it out to listeners', () => {
		const { relay } = makeRelay();
		const seen: Array<[string, number]> = [];
		relay.onJobRoster((sessionId, jobs) => seen.push([sessionId, jobs.length]));
		relay.onJobRosterItem('s1', { jobs: [{ id: 'bash-1', status: 'running' }] });
		expect(relay.jobRosterSnapshot('s1')).toEqual({ jobs: [{ id: 'bash-1', status: 'running' }], pending: false });
		expect(seen).toEqual([['s1', 1]]);
	});

	it('ignores malformed items instead of caching them', () => {
		const { relay } = makeRelay();
		relay.onJobRosterItem('s1', { nope: true });
		expect(relay.jobRosterSnapshot('s1').pending).toBe(true);
		relay.onJobRosterItem('', { jobs: [] });
		expect(relay.jobRosterSnapshot('').pending).toBe(true);
	});

	it('opens the stream on first touch and not again while watched', () => {
		const { relay, opens } = makeRelay();
		relay.touchJobRoster('s1');
		relay.touchJobRoster('s1');
		relay.touchJobRoster('s2');
		expect(opens).toEqual(['s1', 's2']);
	});
});

describe('roster mirror reaper (D2 poll-liveness watch)', () => {
	it('closes the stream and drops the cache past the grace', () => {
		vi.useFakeTimers();
		try {
			const { relay, closes } = makeRelay();
			relay.jobRosterGraceMs = 5_000;
			const t0 = Date.now();
			relay.touchJobRoster('s1');
			relay.onJobRosterItem('s1', { jobs: [{ id: 'bash-1', status: 'running' }] });
			relay.reapJobRosters(t0 + 1_000);
			expect(closes).toEqual([]);
			relay.reapJobRosters(t0 + 6_000);
			expect(closes).toEqual(['s1']);
			expect(relay.jobRosterSnapshot('s1')).toEqual({ jobs: [], pending: true });
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps a session alive while its polls continue', () => {
		vi.useFakeTimers();
		try {
			const { relay, closes } = makeRelay();
			relay.jobRosterGraceMs = 5_000;
			vi.setSystemTime(1_000_000);
			relay.touchJobRoster('s1');
			vi.setSystemTime(1_004_000);
			relay.reapJobRosters();
			relay.touchJobRoster('s1');
			vi.setSystemTime(1_008_000);
			relay.reapJobRosters();
			expect(closes).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('roster mirror failure loudness (D3)', () => {
	it('logs the first stream failure once per session', () => {
		const { relay, logs } = makeRelay();
		relay.onJobRosterStreamError('s1', 'gateway/x', 'boom');
		relay.onJobRosterStreamError('s1', 'gateway/x', 'boom again');
		relay.onJobRosterStreamError('s2', 'gateway/x', 'different session');
		const mirrorLogs = logs.filter((l) => String(l[0]).includes('job/list stream failed'));
		expect(mirrorLogs).toHaveLength(2);
	});
});
