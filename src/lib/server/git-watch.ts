/**
 * git-watch — The Index Pulse (ADR 2026-09-13, D1/D2/D5): the DSI server's
 * per-repo watcher on .git/index. A status-changing git operation rewrites
 * the index, so a debounced burst of watcher events on that one file is a
 * near-perfect "git state changed" signal. The watcher NEVER produces a
 * status answer: on a ring it re-checks the gate and, only on a pass, bumps
 * a per-workspace monotonic generation that SSE clients observe (route:
 * /api/workspace/git-events). The bump rides watcher events + debounce —
 * never mtime comparison (probe 2026-09-13: two index rewrites shared one
 * mtimeNs on APFS).
 *
 * WATCH IMPLEMENTATION (amendment 2026-09-13, ADR D2): raw node:fs.watch
 * on the repo's .git DIRECTORY, filtered to basename 'index' — not chokidar
 * on the index file. Headed verification caught chokidar v5's fs.watch
 * file-layer dropping ALL events for the atomically-replaced index inside
 * a long-lived dev process (vite SSR), while raw fs.watch on the directory
 * delivered every rename (index.lock → index → index) in the same process.
 * The rename burst still lands in the SAME debounce window → ONE bump.
 *
 * Watcher life is refcounted per workspace (ADR D5): created on first
 * acquire, closed when the last SSE client releases. Only this module
 * imports chokidar.
 */
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

import { gitStatus, parsePorcelainStatus } from './git-probe';
import { execFileSync } from 'node:child_process';

/** Trailing debounce window: one git op that touches the index several
 *  times (the index.lock write-then-rename dance) rings exactly once. */
export const DEBOUNCE_MS = 300;

export interface WatchLease {
	/** Drop this client's claim; closes the underlying watcher on last. */
	release(): Promise<void>;
}

interface WatcherEntry {
	watcher: FSWatcher;
	refcount: number;
	repo: string;
	gateCheck: () => Promise<boolean>;
	/** Invoked when a ring's gate re-check fails — the SSE route turns this
	 *  into an enabled:false event and closes the stream (ADR D5). */
	onGateClosed: () => void;
	/** Hash of the index at the last CONFIRMED ring (set at watch creation):
	 *  macOS FSEvents misattributes events (writing HEAD delivers a ghost
	 *  'rename index'), so the event name is not trusted — the debounced
	 *  ring re-hashes the index and bumps only on a real content change. */
	rootWatcher: FSWatcher | null;
	lastStatus: string | null; // porcelain snapshot (JSON of the file list)
	/** Set when a ROOT event (working-tree surface, untracked files) is
	 *  pending in the current debounce burst: root events bypass the index
	 *  hash gate — an untracked file's creation never writes the index, yet
	 *  the operator must see it. The .git-internal path keeps the gate. */
	rootEventPending: boolean;
	/** Trailing debounce timer, shared by every event in one burst. */
	timer: NodeJS.Timeout | null;
}

interface WorkspaceEntry {
	generation: number;
	/** absolute repo path -> watcher entry */
	watchers: Map<string, WatcherEntry>;
	/** generation listeners (the SSE route subscribes per client) */
	listeners: Set<(generation: number) => void>;
}

/** Module-level registry — the DSI server is a long-lived Node process
 *  (adapter-node), so this state persists across requests (ADR fact 8). */
const registry = new Map<string, WorkspaceEntry>();

function workspaceOf(workspaceKey: string): WorkspaceEntry {
	let ws = registry.get(workspaceKey);
	if (!ws) {
		ws = { generation: 0, watchers: new Map(), listeners: new Set() };
		registry.set(workspaceKey, ws);
	}
	return ws;
}

/** Current generation for a workspace (0 before the first ring). */
export function getGeneration(workspaceKey: string): number {
	return registry.get(workspaceKey)?.generation ?? 0;
}

/** Subscribe to generation bumps for one workspace. Returns an unsubscribe. */
export function onGeneration(
	workspaceKey: string,
	cb: (generation: number) => void
): () => void {
	const ws = workspaceOf(workspaceKey);
	ws.listeners.add(cb);
	return () => ws.listeners.delete(cb);
}

function bump(workspaceKey: string): void {
	const ws = registry.get(workspaceKey);
	if (!ws) return;
	ws.generation += 1;
	for (const cb of ws.listeners) {
		try {
			cb(ws.generation);
		} catch {
			// a broken listener never breaks the ring for the others
		}
	}
}

/** The index file this watcher owns (kept for re-establish and tests). */
function indexPath(repo: string): string {
	return join(repo, '.git', 'index');
}



function scheduleRing(workspaceKey: string, entry: WatcherEntry): void {
	if (entry.timer !== null) clearTimeout(entry.timer);
	entry.timer = setTimeout(async () => {
		entry.timer = null;
		// Verify-by-status-diff: ghost FSEvents events must not ring, and pure
		// working-tree changes (untracked files, deep paths) MUST. The event is
		// only a hint; a read-only git status is the judge — bump when the
		// porcelain output differs from the last confirmed snapshot.
		let snapshot: string | null = null;
		try {
			const status = await gitStatus(entry.repo);
			snapshot = JSON.stringify(status.files);
		} catch {
			snapshot = null; // git unavailable / repo mid-teardown: no verdict
		}
		// A failed verification (git unavailable, repo mid-teardown) is NO
		// verdict — never ring on it. The panel's own fetch would fail just
		// as honestly, so silence here matches the surface's contract.
		if (snapshot === null || snapshot === entry.lastStatus) return;
		entry.lastStatus = snapshot;
		entry.rootEventPending = false;
	// placeholder-marker
		// Per-ring gate re-check (ADR D5): a mode switch mid-stream silences
		// the watcher — a closed gate never bumps.
		let open = false;
		try {
			open = await entry.gateCheck();
		} catch {
			open = false; // an unreachable gate is a closed gate
		}
		if (open) {
			bump(workspaceKey);
		} else {
			try {
				entry.onGateClosed();
			} catch {
				// a broken notifier never breaks the watcher
			}
		}
	}, DEBOUNCE_MS);
}

/**
 * Acquire one claim on a repo's index watcher for a workspace. The watcher
 * is created on the FIRST acquire and torn down when the last lease is
 * released (ADR D5). gateCheck is re-resolved on every ring — never cached.
 */
export function acquireWatch(opts: {
	workspaceKey: string;
	/** Absolute repo root (the directory containing .git). */
	repo: string;
	/** Fresh per-ring gate answer — must resolve the DSH evidence live. */
	gateCheck: () => Promise<boolean>;
	/** Optional ring-time gate-closed notification (used by the SSE route). */
	onGateClosed?: () => void;
}): WatchLease {
	const ws = workspaceOf(opts.workspaceKey);
	let entry = ws.watchers.get(opts.repo);
	if (!entry) {
		// Raw fs.watch on the .git DIRECTORY, filtered to the index: the
		// lockfile dance arrives as rename index.lock + rename index, all
		// inside one debounce window (ONE ring), and the rename-over that
		// silently defeated chokidar's file-watch layer is just an event.
		let watcher: FSWatcher;
		try {
			watcher = fsWatch(join(opts.repo, '.git'), () => {
				scheduleRing(opts.workspaceKey, fresh);
			});
		} catch {
			// No .git dir (vanished between probe and watch): a dead lease
			// that stays consistent; a later acquire re-creates.
			const dead: WatcherEntry = {
				watcher: { close: () => undefined } as unknown as FSWatcher,
				rootWatcher: null,
				refcount: 0, repo: opts.repo, gateCheck: opts.gateCheck,
				onGateClosed: opts.onGateClosed ?? (() => undefined), timer: null, lastStatus: null,
				rootEventPending: false
			};
			entry = dead;
			ws.watchers.set(opts.repo, entry);
			entry.refcount += 1;
			let alreadyReleased = false;
			return {
				release: async (): Promise<void> => {
					if (alreadyReleased) return;
					alreadyReleased = true;
					await releaseWatcher(opts.workspaceKey, dead);
				}
			};
		}
		const fresh: WatcherEntry = { watcher, rootWatcher: null, refcount: 0, repo: opts.repo, gateCheck: opts.gateCheck, onGateClosed: opts.onGateClosed ?? (() => undefined), timer: null, lastStatus: statusSnapshotSync(opts.repo), rootEventPending: false };
		entry = fresh;
		watcher.on('error', () => {
			void releaseWatcher(opts.workspaceKey, fresh);
		});
		// Working-tree surface: the repo ROOT, non-recursively. Creating or
		// changing a DIRECT child (a new untracked file, a saved source file)
		// never rewrites the index, so this path rings without the hash gate.
		// Deep paths stay covered by the panel heartbeat (ADR D4 amendment).
		let rootWatcher: FSWatcher | null = null;
		try {
			rootWatcher = fsWatch(opts.repo, (kind, name) => {
				const n = name === null ? '' : String(name);
				if (n === '.git' || n.startsWith('.git')) return; // the index watcher owns .git
				fresh.rootEventPending = true;
				scheduleRing(opts.workspaceKey, fresh);
			});
		} catch {
			rootWatcher = null; // root vanished mid-setup: index watch stays the signal
		}
		fresh.rootWatcher = rootWatcher;
		watcher.on('error', () => {
			void releaseWatcher(opts.workspaceKey, fresh);
		});
		ws.watchers.set(opts.repo, entry);
	}
	entry.refcount += 1;
	let released = false;
	return {
		release: async (): Promise<void> => {
			if (released) return;
			released = true;
			await releaseWatcher(opts.workspaceKey, entry);
		}
	};
}

async function releaseWatcher(workspaceKey: string, entry: WatcherEntry): Promise<void> {
	const ws = registry.get(workspaceKey);
	if (!ws) return;
	const current = ws.watchers.get(entry.repo);
	if (current !== entry) return; // already replaced/closed
	entry.refcount -= 1;
	if (entry.refcount > 0) return;
	ws.watchers.delete(entry.repo);
	if (entry.timer !== null) clearTimeout(entry.timer);
	entry.timer = null;
	try {
		await entry.watcher.close();
	} catch {
		// closing a dead watcher is not an error
	}
	if (entry.rootWatcher !== null) {
		try {
			entry.rootWatcher.close();
		} catch {
			// same
		}
	}
	if (ws.watchers.size === 0 && ws.listeners.size === 0) {
		registry.delete(workspaceKey);
	}
}

/** Test hook: is the repo-root working-tree watcher live? */
export function rootWatchActiveForTests(workspaceKey: string, repo: string): boolean {
	const e = registry.get(workspaceKey)?.watchers.get(repo);
	return e !== undefined && e.rootWatcher !== null;
}

/** SYNC baseline seed (Index Pulse): a null lastStatus makes the first
 *  verified ring bump even when NOTHING changed (FSEvents setup ghosts
 *  made that a real flake). Reading porcelain synchronously at acquire
 *  costs one bounded git child per watcher CREATION (not per ring) and
 *  removes the race an async seed provably has. */
function statusSnapshotSync(repo: string): string | null {
	try {
		const out = execFileSync('git', ['-C', repo, 'status', '--porcelain=v1', '-z'], {
			timeout: 10_000,
			maxBuffer: 4 * 1024 * 1024
		});
		return JSON.stringify(parsePorcelainStatus(out.toString()).files);
	} catch {
		return null; // git missing / repo gone: first ring decides
	}
}

/** Test hook: close everything so suites never leak watchers. */
export async function closeAllForTests(): Promise<void> {
	for (const [, ws] of registry) {
		for (const [, entry] of ws.watchers) {
			if (entry.timer !== null) clearTimeout(entry.timer);
			try {
				await entry.watcher.close();
			} catch {
				// ignore
			}
			if (entry.rootWatcher !== null) {
				try {
					entry.rootWatcher.close();
				} catch {
					// ignore
				}
			}
		}
	}
	registry.clear();
}

/** Test hook: inspect refcounts without reaching into the registry shape. */
export function watcherRefCount(workspaceKey: string, repo: string): number | null {
	return registry.get(workspaceKey)?.watchers.get(repo)?.refcount ?? null;
}

/** Test hook: fire the ring path directly (debounced) — lets the SSE route
 *  tests exercise a bump without touching the real filesystem. */
export function ringForTests(workspaceKey: string, repo: string): void {
	const ws = registry.get(workspaceKey);
	const entry = ws?.watchers.get(repo);
	if (entry) scheduleRing(workspaceKey, entry);
}
