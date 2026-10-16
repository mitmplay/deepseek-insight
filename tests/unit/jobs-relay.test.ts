/**
 * Job relay passthrough + roster listener registry (Job Badge Wave 1,
 * Task 1.2-T). The relay is a passthrough: payloads leave VERBATIM (session
 * fence stays server-side), snapshots normalize only a missing jobs array,
 * and listeners receive every dispatched whole-set frame with unsubscribe
 * semantics. Spec: dev/specs/2026-10/2026-10-16 - Job Badge.
 */
import { describe, expect, it, vi } from 'vitest';
import { RpcRelay } from '../../src/lib/server/connection/rpc-relay';
import type { DsiJobView } from '../../src/lib/types';

function makeRelay(rpcImpl: (method: string, payload: Record<string, unknown>) => unknown) {
	const conn = { rpc: vi.fn(rpcImpl) };
	const relay = new RpcRelay(conn as never, () => 50, {
		answerReapGraceMs: 1000,
		staleGenerationRetryMs: 1000
	});
	return { relay, rpc: conn.rpc };
}

const running: DsiJobView = {
	id: 'bash-1',
	kind: 'bash',
	label: 'npm test',
	owner: 'conv-1',
	status: 'running',
	startedAt: 1,
	output: { total: 0, earliest: 0 }
};

describe('relay job roster', () => {
	// The Roster Mirror (ADR 2026-10-17 D1): the unary job/list call is
	// retired — the mirror is filled by stream items and answered from cache.
	it('touch opens the stream once per watch period; items fill the mirror', () => {
		const { relay } = makeRelay(() => ({}));
		const opens: string[] = [];
		relay.wireJobRosterTransport({ open: (s) => opens.push(s), close: () => {} });
		relay.touchJobRoster('conv-1');
		relay.touchJobRoster('conv-1');
		expect(opens).toEqual(['conv-1']);
		relay.onJobRosterItem('conv-1', { jobs: [running] });
		expect(relay.jobRosterSnapshot('conv-1')).toEqual({ jobs: [running], pending: false });
	});

	it('an item without a jobs array is ignored — the mirror stays honest-pending', () => {
		const { relay } = makeRelay(() => ({}));
		relay.onJobRosterItem('conv-1', {});
		expect(relay.jobRosterSnapshot('conv-1')).toEqual({ jobs: [], pending: true });
	});

	it('jobKill forwards sessionId + jobId verbatim (fence stays server-side)', async () => {
		const { relay, rpc } = makeRelay(() => ({ outcome: 'requested' }));
		const result = await relay.jobKill('conv-1', 'bash-1');
		expect(rpc).toHaveBeenCalledWith('job/kill', { request: { sessionId: 'conv-1', jobId: 'bash-1' } });
		expect(result.outcome).toBe('requested');
	});

	it('listeners receive every dispatched whole-set frame', () => {
		const { relay } = makeRelay(() => ({}));
		const seen: Array<[string, readonly DsiJobView[]]> = [];
		relay.onJobRoster((sessionId, jobs) => seen.push([sessionId, jobs]));
		relay.dispatchJobRoster('conv-1', [running]);
		relay.dispatchJobRoster('conv-1', []); // whole-set replacement, not a delta
		expect(seen).toEqual([
			['conv-1', [running]],
			['conv-1', []]
		]);
	});

	it('unsubscribe stops delivery — a row unwatch leaves no ghost listener', () => {
		const { relay } = makeRelay(() => ({}));
		const seen: unknown[] = [];
		const off = relay.onJobRoster((sessionId, jobs) => seen.push([sessionId, jobs]));
		off();
		relay.dispatchJobRoster('conv-1', [running]);
		expect(seen).toEqual([]);
	});
});
