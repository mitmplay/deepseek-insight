/**
 * plugin-rack — engine invocation wrapper (ADR "The Plugin Rack" 2026-09-27,
 * D2/D3): server API -> engine via child process, JSON stdout. The runner is
 * injectable so tests never spawn the real engine nor touch real homes.
 * Mirrors src/lib/server/skills/engine.ts; deliberately does NOT import it.
 */

export { RackEngineFailedError, RackEngineMissingError } from './types';

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
	RackEngineFailedError,
	RackEngineMissingError,
	type RackApplyItem,
	type RackEnginePayload,
	type RackEngineRunner,
	type RackSnapshot
} from './types';

const execFileP = promisify(execFile);
/** Refresh is a local parse (no network harvest like the shelf) — one
 *  ceiling serves every verb. */
const ENGINE_TIMEOUT_MS = 120_000;

export function defaultEnginePath(): string {
	return process.env.RACK_ENGINE_PATH || join(homedir(), '.agents/skills/dsi-plugin-rack/rack.mjs');
}

function defaultRunner(enginePath: string, args: string[], timeoutMs: number = ENGINE_TIMEOUT_MS): Promise<string> {
	return execFileP('node', [enginePath, ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }).then(
		(r) => r.stdout,
		(err: { stdout?: string; killed?: boolean; message?: string }) => {
			// A nonzero engine exit still carries the JSON fail payload on stdout.
			if (err.stdout) return err.stdout;
			throw err;
		}
	);
}

/** Test seam: override to stub the engine process. */
let runner: RackEngineRunner = defaultRunner;

export function setRackEngineRunner(next: RackEngineRunner | null): void {
	runner = next ?? defaultRunner;
}

async function run(args: string[], timeoutMs?: number): Promise<RackEnginePayload> {
	const enginePath = defaultEnginePath();
	if (!existsSync(enginePath)) throw new RackEngineMissingError(enginePath);
	let stdout: string;
	try {
		stdout = await runner(enginePath, args, timeoutMs);
	} catch (err: unknown) {
		const e = err as { killed?: boolean; message?: string };
		if (e.killed) throw new RackEngineFailedError('rack engine timed out after ' + (timeoutMs ?? ENGINE_TIMEOUT_MS) + 'ms', null);
		throw new RackEngineFailedError(String(e.message ?? e), null);
	}
	let payload: RackEnginePayload;
	try {
		payload = JSON.parse(stdout);
	} catch {
		throw new RackEngineFailedError('rack engine emitted non-JSON output', null);
	}
	if (payload.v !== 1) throw new RackEngineFailedError('rack engine wire version mismatch: v=' + payload.v, payload);
	return payload;
}

export function getRackEngine() {
	return {
		async snapshotStatus(): Promise<{ present: boolean }> {
			const p = await run(['snapshot-status']);
			return { present: Boolean(p.present) };
		},

		async refresh(reload: boolean, extraArgs: string[] = []): Promise<{ snapshot: RackSnapshot; reused: boolean; errors?: string[] }> {
			const p = await run(['refresh', ...(reload ? ['--reload'] : []), ...extraArgs]);
			if (!p.snapshot) throw new RackEngineFailedError('rack refresh returned no snapshot', p);
			return { snapshot: p.snapshot, reused: Boolean(p.reused), ...(p.errors ? { errors: p.errors } : {}) };
		},

		async apply(action: 'install' | 'remove', targets: string[], extraArgs: string[] = []): Promise<RackApplyItem[]> {
			const p = await run(['apply', action, ...targets, ...extraArgs]);
			if (!p.results) throw new RackEngineFailedError('rack apply returned no results', p);
			return p.results;
		}
	};
}
