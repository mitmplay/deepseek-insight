/**
 * skill-shelf — engine invocation wrapper (PRD Module Communication Map:
 * server API -> engine via child process, JSON stdout). The runner is injectable
 * so tests never spawn the real engine nor touch real home directories.
 */

export { EngineFailedError, EngineMissingError } from './types';

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
	EngineCancelledError,
	EngineFailedError,
	EngineMissingError,
	type EnginePayload,
	type EngineRunner,
	type ShelfApplyItem,
	type ShelfSnapshot
} from './types';

const execFileP = promisify(execFile);
/** Fast commands (status, cached refresh, apply) stay on the snappy floor. */
const ENGINE_TIMEOUT_MS = 120_000;
/** A FULL live refresh enumerates ~140 skills and fetches every raw
 *  SKILL.md + package.json sequentially (~6m measured 2026-09-22) — the
 *  reload verb dies at 120s with 'shelf engine timed out' (observed in
 *  headed verification). Give the slow command room to finish. */
const ENGINE_REFRESH_TIMEOUT_MS = Number(process.env.SHELF_REFRESH_TIMEOUT_MS) || 600_000;

export function defaultEnginePath(): string {
	return process.env.SHELF_ENGINE_PATH || join(homedir(), '.agents/skills/dsi-skill-shelf/shelf.mjs');
}

/** Default runner (Reload Rememberer cancel support, 2026-09-23): the
 *  real child handle is exposed through registerCancel so cancelRefresh
 *  can SIGTERM the in-flight harvest. */
function defaultRunner(
	enginePath: string,
	args: string[],
	timeoutMs: number = ENGINE_TIMEOUT_MS,
	registerCancel?: (cancel: () => void) => void
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const child = execFile('node', [enginePath, ...args], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
			if (err) reject(err);
			else resolve(stdout);
		});
		if (registerCancel) registerCancel(() => child.kill('SIGTERM'));
	});
}

/** Test seam: override to stub the engine process. */
let runner: EngineRunner = defaultRunner;

export function setEngineRunner(next: EngineRunner | null): void {
	runner = next ?? defaultRunner;
}

/** Handle to the ONE in-flight engine child (single-flight refresh):
 *  cancelRefresh kills it; null when nothing runs or a stubbed runner
 *  (tests) cannot expose a process. */
let activeKill: (() => void) | null = null;
let cancelRequested = false;

async function run(args: string[], timeoutMs: number = ENGINE_TIMEOUT_MS): Promise<EnginePayload> {
	const enginePath = defaultEnginePath();
	if (!existsSync(enginePath)) throw new EngineMissingError(enginePath);
	let stdout: string;
	cancelRequested = false;
	try {
		stdout = await runner(enginePath, args, timeoutMs, (cancel) => (activeKill = cancel));
	} catch (err: unknown) {
		activeKill = null;
		const e = err as { killed?: boolean; message?: string };
		if (cancelRequested) throw new EngineCancelledError();
		if (e.killed) throw new EngineFailedError('shelf engine timed out after ' + timeoutMs + 'ms', null);
		throw new EngineFailedError(String(e.message ?? e), null);
	}
	activeKill = null;
	let payload: EnginePayload;
	try {
		payload = JSON.parse(stdout);
	} catch {
		throw new EngineFailedError('shelf engine emitted non-JSON output', null);
	}
	if (payload.v !== 1) throw new EngineFailedError('shelf engine wire version mismatch: v=' + payload.v, payload);
	return payload;
}

/** Single-flight (Reload Rememberer amendment, 2026-09-23): the browser
 *  aborts its POST on a hard reload, but the engine child keeps harvesting
 *  server-side — and D4's re-issue used to spawn a SECOND full harvest
 *  (no per-source resume: refresh --reload refetches every source), so
 *  the operator waited ~6m from zero twice over. A re-issued refresh now
 *  JOINS the in-flight run instead of spawning a duplicate engine. */
let inFlightRefresh: Promise<{ snapshot: ShelfSnapshot; reused: boolean }> | null = null;

/** Cancel the in-flight refresh (Reload Rememberer, 2026-09-23): kills
 *  the engine child, and run() rejects every rider with
 *  EngineCancelledError. The snapshot cache is only written at the END
 *  of a successful run, so the OLD snapshot survives untouched. The
 *  progress sidecar is the route's to clear (it owns the path seam). */
export function cancelRefresh(): boolean {
	if (!activeKill) return false;
	cancelRequested = true;
	activeKill();
	return true;
}

export function getEngine() {
	return {
		cancelRefresh,
		async snapshotStatus(): Promise<{ present: boolean }> {
			const p = await run(['snapshot-status']);
			return { present: Boolean(p.present) };
		},
		async refresh(reload: boolean): Promise<{ snapshot: ShelfSnapshot; reused: boolean }> {
			if (reload && inFlightRefresh) return inFlightRefresh;
			const p = run(reload ? ['refresh', '--reload'] : ['refresh'], reload ? ENGINE_REFRESH_TIMEOUT_MS : ENGINE_TIMEOUT_MS).then((p) => {
				if (!p.ok || !p.snapshot) throw new EngineFailedError('refresh failed', p);
				return { snapshot: p.snapshot, reused: Boolean(p.reused) };
			});
			if (reload) {
				inFlightRefresh = p;
				void p.catch(() => {}).finally(() => {
					if (inFlightRefresh === p) inFlightRefresh = null;
				});
			}
			return p;
		},
		async apply(action: 'install' | 'uninstall', targets: string[]): Promise<ShelfApplyItem[]> {
			const p = await run(['apply', action, ...targets]);
			if (!p.results) throw new EngineFailedError('apply returned no results', p);
			return p.results;
		}
	};
}