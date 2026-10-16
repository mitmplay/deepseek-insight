/**
 * Job roster wire types (Job Badge Wave 1, Task 1.1-T) — the DSI mirror of
 * the host client-safe vocabulary (dsh job-controller types.ts / jobs view.ts).
 * Type-only module: the test pins the fixture shape so a future host drift
 * breaks here first, before any consumer compiles against a stale field.
 * Spec: dev/specs/2026-10/2026-10-16 - Job Badge (Tasks 1.1/1.1-T).
 */
import { describe, expect, it } from 'vitest';
import type {
	DsiJobKillResult,
	DsiJobListFrame,
	DsiJobStatus,
	DsiJobView
} from '../../src/lib/types';

describe('job roster wire types', () => {
	it('accepts a live JobView fixture shaped like the host projection', () => {
		const job: DsiJobView = {
			id: 'bash-prod-deploy-abc123',
			kind: 'bash',
			label: 'npm run build && npm run deploy',
			owner: 'conv-xyz789',
			status: 'running',
			progress: 'Compiling... 45%',
			startedAt: 1760610000000,
			output: { total: 512, earliest: 0 }
		};
		expect(job.status).toBe('running');
		expect(job.finishedAt).toBeUndefined();
	});

	it('accepts a settled JobView with a terminal status and finish time', () => {
		const job: DsiJobView = {
			id: 'bash-prod-deploy-abc123',
			kind: 'bash',
			label: 'deploy',
			status: 'killed',
			detail: 'exit code: 137',
			startedAt: 1760610000000,
			finishedAt: 1760610060000,
			output: { total: 1024, earliest: 128 }
		};
		expect(job.finishedAt).toBe(1760610060000);
	});

	it('accepts an unowned job (owner absent) — visible in every roster', () => {
		const job: DsiJobView = {
			id: 'bash-orphan-1',
			kind: 'bash',
			label: 'unowned work',
			status: 'running',
			startedAt: 0,
			output: { total: 0, earliest: 0 }
		};
		expect(job.owner).toBeUndefined();
	});

	it('constrains status to the five host lifecycle states', () => {
		const states: DsiJobStatus[] = ['running', 'stopping', 'completed', 'killed', 'failed'];
		expect(states).toHaveLength(5);
	});

	it('frames are whole-set replacements (jobs array, no delta fields)', () => {
		const frame: DsiJobListFrame = { jobs: [] };
		expect(Object.keys(frame)).toEqual(['jobs']);
	});

	it('kill receipts carry only the host outcome union', () => {
		const requested: DsiJobKillResult = { outcome: 'requested' };
		const finished: DsiJobKillResult = { outcome: 'already-finished' };
		expect([requested.outcome, finished.outcome]).toEqual(['requested', 'already-finished']);
	});
});
