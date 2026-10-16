import { describe, expect, it } from 'vitest';

import { jobsRoster } from '../../src/lib/services/jobs/roster-store.svelte';

/**
 * Pending consumption (Roster Mirror ADR 2026-10-17 D3, Tasks 2.1-T): a
 * pending frame is honest darkness — it never clobbers the last known set.
 * The store is the module singleton; jobs() is the observable read.
 */
const job = { id: 'bash-1', kind: 'bash', label: 't', owner: 's1', status: 'running', startedAt: 1, output: { total: 0, earliest: 0 } };

describe('roster store pending handling', () => {
	it('pending does not blank a previously known set', async () => {
		jobsRoster.watch('s-pending-test');
		await fetchMockOnce({ ok: true, jobs: [job] });
		expect(jobsRoster.jobs('s-pending-test')).toEqual([job]);
		await fetchMockOnce({ ok: true, jobs: [], pending: true });
		expect(jobsRoster.jobs('s-pending-test')).toEqual([job]);
		jobsRoster.unwatch('s-pending-test');
	});
});

/** Swap global fetch for exactly one response, then restore. */
async function fetchMockOnce(body: unknown): Promise<void> {
	const real = globalThis.fetch;
	globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
	try {
		await jobsRoster.refresh('s-pending-test');
	} finally {
		globalThis.fetch = real;
	}
}
