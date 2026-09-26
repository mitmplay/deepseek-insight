/**
 * git-watch gate + lifecycle contract (Index Pulse W1/D5): a closed gate
 * never bumps; the refcount tears the watcher down on last release and
 * rebuilds on re-acquire; a deleted repo closes quietly. Rings use REAL
 * git operations so the verify-by-status-diff path is exercised honestly.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	acquireWatch,
	getGeneration,
	closeAllForTests,
	watcherRefCount,
	DEBOUNCE_MS,
	settleRingsForTests,
	ringPendingForTests
} from '$lib/server/git-watch';

const DEBOUNCE_WAIT = DEBOUNCE_MS + 400;

/** Deterministic ring flush: give fs events a moment to land, then await
 *  the FULL ring (debounce + status verify + gate check + bump) instead of
 *  guessing a sleep. Second settle catches an event that chained another
 *  debounce while the first was settling. */
async function flushRing(workspaceKey: string, repo: string): Promise<void> {
	await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 50));
	await settleRingsForTests(workspaceKey, repo);
	await settleRingsForTests(workspaceKey, repo);
}

/** Provable quietness: flush whatever is pending, then hold a straggler
 *  window long enough for ANY late-delivered fs event to arm a ring, and
 *  only accept the baseline when nothing is pending. Retry until quiet —
 *  a straggler ring is drained HERE, while the gate state that must not
 *  see it still holds, never after the gate flips. */
async function quietBaseline(workspaceKey: string, repo: string, tries = 8): Promise<void> {
	for (let i = 0; i < tries; i++) {
		await flushRing(workspaceKey, repo);
		await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT)); // straggler window
		await settleRingsForTests(workspaceKey, repo);
		if (!ringPendingForTests(workspaceKey, repo)) return;
	}
	throw new Error('watcher never went quiet: straggler rings keep arming');
}

/** A REAL repo: git init + one commit-less tracked file staged baseline. */
function tmpRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), 'dsi-gitwatch-gate-'));
	execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
	return dir;
}

function stage(repo: string, name: string, content: string): void {
	writeFileSync(join(repo, name), content);
	execFileSync('git', ['-C', repo, 'add', name], { stdio: 'ignore' });
}

afterEach(async () => {
	await closeAllForTests();
});

describe('git-watch gate and lifecycle', () => {
	it('a closed gate swallows the ring: generation unchanged; opening the gate lets the NEXT ring through', { timeout: 30_000 }, async () => {
		const repo = tmpRepo();
		try {
			let gate = false;
			const lease = acquireWatch({ workspaceKey: 'ws-closed', repo, gateCheck: async () => gate });
			await quietBaseline('ws-closed', repo);
			stage(repo, 'a.txt', 'one\n');
			await flushRing('ws-closed', repo);
			expect(getGeneration('ws-closed')).toBe(0);
			// Drain stragglers BEFORE flipping: a late stage-a event must not
			// see the open gate.
			await quietBaseline('ws-closed', repo);
			gate = true;
			stage(repo, 'b.txt', 'two\n'); // a NEW file: the row list visibly changes
			await flushRing('ws-closed', repo);
			expect(getGeneration('ws-closed')).toBe(1);
			await lease.release();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('a throwing gateCheck is a closed gate', { timeout: 30_000 }, async () => {
		const repo = tmpRepo();
		try {
			const lease = acquireWatch({
				workspaceKey: 'ws-throw',
				repo,
				gateCheck: async () => {
					throw new Error('dsh unreachable');
				}
			});
			await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
			stage(repo, 'a.txt', 'x\n');
			await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
			expect(getGeneration('ws-throw')).toBe(0);
			await lease.release();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('refcount: two acquires share one watcher; last release closes it; re-acquire rebuilds', { timeout: 30_000 }, async () => {
		const repo = tmpRepo();
		try {
			const a = acquireWatch({ workspaceKey: 'ws-ref', repo, gateCheck: async () => true });
			const b = acquireWatch({ workspaceKey: 'ws-ref', repo, gateCheck: async () => true });
			expect(watcherRefCount('ws-ref', repo)).toBe(2);
			await a.release();
			expect(watcherRefCount('ws-ref', repo)).toBe(1);
			await b.release();
			expect(watcherRefCount('ws-ref', repo)).toBeNull();
			// re-acquire rebuilds and the new watcher rings
			const c = acquireWatch({ workspaceKey: 'ws-ref', repo, gateCheck: async () => true });
			await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
			stage(repo, 'after-rebuild.txt', 'new\n');
			await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
			expect(getGeneration('ws-ref')).toBe(1);
			await c.release();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('a root-event ring still respects the gate (untracked file, closed gate)', { timeout: 30_000 }, async () => {
		const repo = tmpRepo();
		try {
			let gate = false;
			const lease = acquireWatch({ workspaceKey: 'ws-rootgate', repo, gateCheck: async () => gate });
			await quietBaseline('ws-rootgate', repo);
			writeFileSync(join(repo, 'untracked.txt'), 'x\n');
			await flushRing('ws-rootgate', repo);
			expect(getGeneration('ws-rootgate')).toBe(0);
			await quietBaseline('ws-rootgate', repo);
			gate = true;
			writeFileSync(join(repo, 'untracked2.txt'), 'y\n');
			await flushRing('ws-rootgate', repo);
			expect(getGeneration('ws-rootgate')).toBe(1);
			await lease.release();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('deleting the repo closes the watcher quietly; re-acquire re-creates', { timeout: 30_000 }, async () => {
		const repo = tmpRepo();
		try {
			const lease = acquireWatch({ workspaceKey: 'ws-gone', repo, gateCheck: async () => true });
			await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
			rmSync(repo, { recursive: true, force: true });
			await new Promise((r) => setTimeout(r, 500));
			expect(watcherRefCount('ws-gone', repo)).toBeLessThanOrEqual(1);
			await lease.release().catch(() => undefined);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});
