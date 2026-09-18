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
	DEBOUNCE_MS
} from '$lib/server/git-watch';

const DEBOUNCE_WAIT = DEBOUNCE_MS + 400;

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
	it('a closed gate swallows the ring: generation unchanged; opening the gate lets the NEXT ring through', async () => {
		const repo = tmpRepo();
		try {
			let gate = false;
			const lease = acquireWatch({ workspaceKey: 'ws-closed', repo, gateCheck: async () => gate });
			await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
			stage(repo, 'a.txt', 'one\n');
			await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
			expect(getGeneration('ws-closed')).toBe(0);
			gate = true;
			stage(repo, 'b.txt', 'two\n'); // a NEW file: the row list visibly changes
			await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
			expect(getGeneration('ws-closed')).toBe(1);
			await lease.release();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('a throwing gateCheck is a closed gate', async () => {
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

	it('refcount: two acquires share one watcher; last release closes it; re-acquire rebuilds', async () => {
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

	it('a root-event ring still respects the gate (untracked file, closed gate)', async () => {
		const repo = tmpRepo();
		try {
			let gate = false;
			const lease = acquireWatch({ workspaceKey: 'ws-rootgate', repo, gateCheck: async () => gate });
			await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
			writeFileSync(join(repo, 'untracked.txt'), 'x\n');
			await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
			expect(getGeneration('ws-rootgate')).toBe(0);
			gate = true;
			writeFileSync(join(repo, 'untracked2.txt'), 'y\n');
			await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
			expect(getGeneration('ws-rootgate')).toBe(1);
			await lease.release();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('deleting the repo closes the watcher quietly; re-acquire re-creates', async () => {
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
