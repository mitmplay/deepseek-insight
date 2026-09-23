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

/** Test seam: override to stub the engine process. */
let runner: EngineRunner = async (enginePath, args, timeoutMs = ENGINE_TIMEOUT_MS) => {
	const { stdout } = await execFileP('node', [enginePath, ...args], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
	return stdout;
};

export function setEngineRunner(next: EngineRunner | null): void {
	runner = next ?? (async (enginePath, args, timeoutMs = ENGINE_TIMEOUT_MS) => {
		const { stdout } = await execFileP('node', [enginePath, ...args], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
		return stdout;
	});
}

async function run(args: string[], timeoutMs: number = ENGINE_TIMEOUT_MS): Promise<EnginePayload> {
	const enginePath = defaultEnginePath();
	if (!existsSync(enginePath)) throw new EngineMissingError(enginePath);
	let stdout: string;
	try {
		stdout = await runner(enginePath, args, timeoutMs);
	} catch (err: unknown) {
		const e = err as { killed?: boolean; message?: string };
		if (e.killed) throw new EngineFailedError('shelf engine timed out after ' + timeoutMs + 'ms', null);
		throw new EngineFailedError(String(e.message ?? e), null);
	}
	let payload: EnginePayload;
	try {
		payload = JSON.parse(stdout);
	} catch {
		throw new EngineFailedError('shelf engine emitted non-JSON output', null);
	}
	if (payload.v !== 1) throw new EngineFailedError('shelf engine wire version mismatch: v=' + payload.v, payload);
	return payload;
}

export function getEngine() {
	return {
		async snapshotStatus(): Promise<{ present: boolean }> {
			const p = await run(['snapshot-status']);
			return { present: Boolean(p.present) };
		},
		async refresh(reload: boolean): Promise<{ snapshot: ShelfSnapshot; reused: boolean }> {
			const p = await run(reload ? ['refresh', '--reload'] : ['refresh'], reload ? ENGINE_REFRESH_TIMEOUT_MS : ENGINE_TIMEOUT_MS);
			if (!p.ok || !p.snapshot) throw new EngineFailedError('refresh failed', p);
			return { snapshot: p.snapshot, reused: Boolean(p.reused) };
		},
		async apply(action: 'install' | 'uninstall', targets: string[]): Promise<ShelfApplyItem[]> {
			const p = await run(['apply', action, ...targets]);
			if (!p.results) throw new EngineFailedError('apply returned no results', p);
			return p.results;
		}
	};
}