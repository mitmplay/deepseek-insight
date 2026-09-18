/**
 * git-watch edge branches (coverage pass 2026-09-14): the paths the
 * debounce/gate suites never reach — dead leases (no .git), ring-time
 * status-verification failure, gate-closed notification (including a
 * throwing notifier), listener isolation (a broken listener never breaks
 * the ring), onGeneration unsubscribe, and the root-event filter
 * (.git-prefixed names are skipped; everything else pends a ring).
 *
 * git-probe is MOCKED here so the verify-by-status-diff verdict is
 * deterministic without spawning git; statusSnapshotSync's real
 * execFileSync call therefore fails and exercises its catch (null seed).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	acquireWatch,
	getGeneration,
	onGeneration,
	closeAllForTests,
	watcherRefCount,
	rootWatchActiveForTests,
	ringForTests,
	DEBOUNCE_MS
} from '$lib/server/git-watch';

const probe = vi.hoisted(() => {
	const state = {
		// null = gitStatus throws (git unavailable)
		files: null as string[] | null
	};
	return {
		state,
		gitStatus: vi.fn(async () => {
			if (state.files === null) throw new Error('git unavailable');
			return { files: state.files, branch: 'main' };
		}),
		parsePorcelainStatus: vi.fn(() => ({ files: ['seed-row'] }))
	};
});

vi.mock('$lib/server/git-probe', () => ({
	gitStatus: probe.gitStatus,
	parsePorcelainStatus: probe.parsePorcelainStatus
}));

const WAIT = DEBOUNCE_MS + 400;

/** A real git repo (git init): statusSnapshotSync's REAL execFileSync must
 *  succeed so the seed snapshot is non-null and can match a ring verdict. */
function tmpDotGit(): string {
	const dir = mkdtempSync(join(tmpdir(), 'dsi-gitwatch-edges-'));
	execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
	return dir;
}

/** A bare directory: fs.watch on .git throws -> the dead-lease path. */
function tmpNoGit(): string {
	return mkdtempSync(join(tmpdir(), 'dsi-gitwatch-edge.dead-'));
}

function waitForGeneration(key: string, baseline: number, timeoutMs = 8000): Promise<number> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = (): void => {
			const g = getGeneration(key);
			if (g > baseline) return resolve(g);
			if (Date.now() - started > timeoutMs) return reject(new Error('never bumped'));
			setTimeout(tick, 25);
		};
		tick();
	});
}

afterEach(async () => {
	probe.state.files = null;
	probe.gitStatus.mockClear();
	await closeAllForTests();
});

describe('git-watch edge branches', () => {
	it('acquiring a repo WITHOUT .git yields a dead lease: consistent refcount, idempotent double release', async () => {
		const dir = tmpNoGit();
		try {
			const lease = acquireWatch({
				workspaceKey: 'ws-dead',
				repo: dir,
				gateCheck: async () => true
			});
			expect(watcherRefCount('ws-dead', dir)).toBe(1);
			expect(rootWatchActiveForTests('ws-dead', dir)).toBe(false);
			await lease.release();
			expect(watcherRefCount('ws-dead', dir)).toBeNull();
			await lease.release(); // second release is a no-op (alreadyReleased)
			expect(watcherRefCount('ws-dead', dir)).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('a verified ring bumps and notifies listeners; a THROWING listener never breaks the ring', async () => {
		const dir = tmpDotGit();
		try {
			const seen: number[] = [];
			const stop = onGeneration('ws-ring', (g) => {
				seen.push(g);
				throw new Error('broken listener');
			});
			const lease = acquireWatch({ workspaceKey: 'ws-ring', repo: dir, gateCheck: async () => true });
			// seed rows differ from the ring's verdict -> the ring passes
			probe.state.files = ['changed-row'];
			ringForTests('ws-ring', dir);
			await waitForGeneration('ws-ring', 0);
			expect(seen.length).toBeGreaterThanOrEqual(1);
			expect(seen[0]).toBe(1);
			// unsubscribe: further rings notify nothing
			stop();
			probe.state.files = ['changed-row-2'];
			ringForTests('ws-ring', dir);
			await waitForGeneration('ws-ring', 1);
			expect(seen).toHaveLength(1);
			await lease.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('status verification FAILURE (gitStatus throws) is no verdict: no bump', async () => {
		const dir = tmpDotGit();
		try {
			const lease = acquireWatch({ workspaceKey: 'ws-noverdict', repo: dir, gateCheck: async () => true });
			probe.state.files = null; // gitStatus will throw
			ringForTests('ws-noverdict', dir);
			await new Promise((r) => setTimeout(r, WAIT));
			expect(getGeneration('ws-noverdict')).toBe(0);
			await lease.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('a closed gate routes to onGateClosed; a throwing notifier is swallowed; no bump', async () => {
		const dir = tmpDotGit();
		try {
			let closed = 0;
			const lease = acquireWatch({
				workspaceKey: 'ws-closed-edge',
				repo: dir,
				gateCheck: async () => false,
				onGateClosed: () => {
					closed += 1;
					if (closed === 1) throw new Error('broken notifier');
				}
			});
			probe.state.files = ['changed-row'];
			ringForTests('ws-closed-edge', dir);
			await new Promise((r) => setTimeout(r, WAIT));
			expect(getGeneration('ws-closed-edge')).toBe(0);
			expect(closed).toBe(1);
			// a second closed ring calls the (recovered) notifier again
			probe.state.files = ['changed-row-2'];
			ringForTests('ws-closed-edge', dir);
			await new Promise((r) => setTimeout(r, WAIT));
			expect(closed).toBe(2);
			await lease.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('an unchanged status verdict stays silent (snapshot === lastStatus)', async () => {
		const dir = tmpDotGit();
		try {
			const lease = acquireWatch({ workspaceKey: 'ws-same', repo: dir, gateCheck: async () => true });
			probe.state.files = ['seed-row']; // identical to the seed snapshot
			ringForTests('ws-same', dir);
			await new Promise((r) => setTimeout(r, WAIT));
			expect(getGeneration('ws-same')).toBe(0);
			await lease.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('repo-root event filter: .git-prefixed names are skipped; a real root file pends and rings', async () => {
		const dir = tmpDotGit();
		try {
			const lease = acquireWatch({ workspaceKey: 'ws-filter', repo: dir, gateCheck: async () => true });
			expect(rootWatchActiveForTests('ws-filter', dir)).toBe(true);
			await new Promise((r) => setTimeout(r, WAIT));
			// .git-prefixed sibling: the filter must SKIP it (no ring)
			writeFileSync(join(dir, '.gitignore-local'), 'noise\n');
			await new Promise((r) => setTimeout(r, WAIT));
			expect(getGeneration('ws-filter')).toBe(0);
			// a real root file: pends a ring whose status diff passes
			probe.state.files = ['new-untracked'];
			writeFileSync(join(dir, 'untracked-root.txt'), 'real\n');
			await waitForGeneration('ws-filter', 0);
			expect(getGeneration('ws-filter')).toBe(1);
			await lease.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('ringForTests on an unknown workspace/repo is a quiet no-op', async () => {
		ringForTests('ws-unknown', '/nonexistent/repo');
		ringForTests('ws-unknown2', '/nonexistent/repo');
		await new Promise((r) => setTimeout(r, 50));
		expect(getGeneration('ws-unknown')).toBe(0);
	});

	it('release after the registry entry was replaced is a no-op (stale lease)', async () => {
		const dir = tmpDotGit();
		try {
			const a = acquireWatch({ workspaceKey: 'ws-stale', repo: dir, gateCheck: async () => true });
			await closeAllForTests(); // registry wiped under the lease
			await a.release(); // must not throw
			expect(watcherRefCount('ws-stale', dir)).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
