/**
 * WorkflowRunCard unit tests — the orchestration popup body: name, live
 * tally, per-member rows with glyphs/durations, and the status word.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import WorkflowRunCard from '../../src/lib/components/message/cards/WorkflowRunCard.svelte';
import type { DsiEntry, DsiWorkflowAgent } from '$lib/types';

function mountCard(entry: Extract<DsiEntry, { kind: 'workflow-run' }>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WorkflowRunCard, { target, props: { entry } });
	flushSync();
	return { target, instance };
}

const AGENTS: DsiWorkflowAgent[] = [
	{ seq: 0, label: 'scout the repo', childId: 'child-0', status: 'completed', startedAt: 1000, endedAt: 41000 },
	{ seq: 1, label: 'build the feature', childId: 'child-1', phase: 'wave-1', status: 'running', startedAt: 41500 },
	{ seq: 2, label: 'write tests', childId: 'child-2', status: 'failed', startedAt: 41500, endedAt: 50000 }
];

function runEntry(overrides: Partial<Extract<DsiEntry, { kind: 'workflow-run' }>> = {}) {
	return {
		kind: 'workflow-run' as const,
		id: 'wf:run-1',
		seq: 10,
		time: 50000,
		runId: 'run-1',
		name: 'build feature',
		status: 'running' as const,
		agents: AGENTS,
		...overrides
	};
}

describe('WorkflowRunCard', () => {
	it('renders the name, tally, and status word', () => {
		const { target, instance } = mountCard(runEntry());
		expect(target.querySelector('[data-testid="workflow-run-name"]')?.textContent).toBe('build feature');
		// the tally counts SETTLED members (completed + failed), not successes
		expect(target.querySelector('[data-testid="workflow-run-tally"]')?.textContent).toBe('2/3');
		expect(target.querySelector('[data-testid="workflow-run-status"]')?.textContent?.trim()).toBe('running');
		unmount(instance);
	});

	it('rows carry statuses in member order, with phase and durations', () => {
		const { target, instance } = mountCard(runEntry());
		const rows = [...target.querySelectorAll('[data-testid="workflow-agent-row"]')];
		expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['completed', 'running', 'failed']);
		expect(rows[0].textContent).toContain('scout the repo');
		expect(rows[1].textContent).toContain('wave-1');
		// durations from wire times: 40s and 8.5s→9s
		expect(rows[0].textContent).toContain('40s');
		expect(rows[2].textContent).toContain('9s');
		unmount(instance);
	});

	it('terminal status flips the status word; an empty run says so honestly', () => {
		const { target, instance } = mountCard(runEntry({ status: 'failed', agents: [] }));
		expect(target.querySelector('[data-testid="workflow-run-status"]')?.textContent?.trim()).toBe('failed');
		expect(target.querySelector('[data-testid="workflow-run-empty"]')).not.toBeNull();
		unmount(instance);
	});
});
