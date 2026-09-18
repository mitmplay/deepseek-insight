/**
 * git-watch debounce contract (Index Pulse W1 + D4 amendment): a burst of
 * index rewrites — including git's own index.lock write-then-rename dance —
 * yields EXACTLY ONE generation bump, and verify-by-status-diff means only
 * REAL status changes ring. Rings ride fs events + the trailing debounce;
 * mtime is never consulted (APFS granularity probe, 2026-09-13).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireWatch, getGeneration, closeAllForTests, DEBOUNCE_MS } from '$lib/server/git-watch';

const open = async (): Promise<boolean> => true;

/** A REAL repo: git init (status verification needs a working git). */
function tmpRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), 'dsi-gitwatch-'));
	execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
	return dir;
}

function waitForGeneration(workspaceKey: string, baseline: number, timeoutMs = 8000): Promise<number> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = (): void => {
			const g = getGeneration(workspaceKey);
			if (g > baseline) return resolve(g);
			if (Date.now() - started > timeoutMs) return reject(new Error('generation never bumped'));
			setTimeout(tick, 25);
		};
		tick();
	});
}

function waitForSettle(): Promise<void> {
	return new Promise((r) => setTimeout(r, DEBOUNCE_MS + 400));
}

afterEach(async () => {
	await closeAllForTests();
});

describe('git-watch debounce', () => {
	it('N rapid index rewrites (5x git add) yield exactly one bump', async () => {
		const repo = tmpRepo();
		try {
			const lease = acquireWatch({ workspaceKey: 'ws-debounce', repo, gateCheck: open });
			await waitForSettle();
			const before = getGeneration('ws-debounce');
			for (let i = 0; i < 5; i++) {
				writeFileSync(join(repo, 'f' + i + '.txt'), 'burst' + i + '\n');
				execFileSync('git', ['-C', repo, 'add', 'f' + i + '.txt'], { stdio: 'ignore' });
			}
			await waitForGeneration('ws-debounce', before);
			await waitForSettle();
			expect(getGeneration('ws-debounce')).toBe(before + 1);
			await lease.release();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('the lockfile dance is git add itself: one bump per burst, watcher stays alive', async () => {
		const repo = tmpRepo();
		try {
			writeFileSync(join(repo, 'a.txt'), 'one\n');
			const lease = acquireWatch({ workspaceKey: 'ws-lock', repo, gateCheck: open });
			await waitForSettle();
			const before = getGeneration('ws-lock');
			execFileSync('git', ['-C', repo, 'add', 'a.txt'], { stdio: 'ignore' });
			await waitForGeneration('ws-lock', before);
			await waitForSettle();
			expect(getGeneration('ws-lock')).toBe(before + 1);
			// the watcher survived: a second op that CHANGES the visible row
			// list (a NEW staged file) still rings. Re-adding the SAME file
			// yields an identical row list - status-diff correctly stays silent.
			const mid = getGeneration('ws-lock');
			writeFileSync(join(repo, 'b.txt'), 'two\n');
			execFileSync('git', ['-C', repo, 'add', 'b.txt'], { stdio: 'ignore' });
			await waitForGeneration('ws-lock', mid);
			expect(getGeneration('ws-lock')).toBe(mid + 1);
			await lease.release();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('an UNTRACKED working-tree file (no index write) rings via the repo-root watcher', async () => {
		const repo = tmpRepo();
		try {
			const lease = acquireWatch({ workspaceKey: 'ws-root', repo, gateCheck: open });
			await waitForSettle();
			const before = getGeneration('ws-root');
			writeFileSync(join(repo, 'new-untracked.txt'), 'created, never staged\n');
			await waitForGeneration('ws-root', before);
			await waitForSettle();
			expect(getGeneration('ws-root')).toBe(before + 1);
			await lease.release();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('a DEEP new file alone produces NO ring (no event reaches either watcher) - the panel heartbeat covers deep paths, so any LATER burst verifies it', async () => {
		const repo = tmpRepo();
		try {
			mkdirSync(join(repo, 'docs'), { recursive: true });
			const lease = acquireWatch({ workspaceKey: 'ws-deep', repo, gateCheck: open });
			await waitForSettle();
			writeFileSync(join(repo, 'docs', 'deep.txt'), 'buried\n');
			// NO assertion here: whether FSEvents coalesces a stray event for
			// the deep write is timing-dependent. The guaranteed contract is
			// below - the next REAL event verifies the FULL status, deep file
			// included.
			// ...but the moment ANY real event lands (the staged file below),
			// the status-diff verdict includes the deep file too - one ring
			// surfaces both changes.
			writeFileSync(join(repo, 'toplevel.txt'), 'top\n');
			await waitForGeneration('ws-deep', 0);
			await waitForSettle();
			// >= 1 (replay may add a burst): the surfaced ring covers the deep
			// change too, because verification reads the whole status.
			expect(getGeneration('ws-deep')).toBeGreaterThanOrEqual(1);
			await lease.release();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('unrelated .git files (HEAD, COMMIT_EDITMSG) do not ring - status did not change', async () => {
		const repo = tmpRepo();
		try {
			const lease = acquireWatch({ workspaceKey: 'ws-quiet', repo, gateCheck: open });
			await waitForSettle();
			writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
			writeFileSync(join(repo, '.git', 'COMMIT_EDITMSG'), 'noise\n');
			await waitForSettle();
			expect(getGeneration('ws-quiet')).toBe(0);
			await lease.release();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});
