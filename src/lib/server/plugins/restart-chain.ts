/**
 * plugin-rack — the detached restart-chain spawn (ADR D5). The apply route
 * calls this AFTER the engine's dsh work is done: the chain is the
 * RESTART-ONLY half (killOrphans + dsi dsh --sync: token re-sync + re-serve),
 * spawned detached + unref so the HTTP response comes home before the floor
 * goes down. The install+restart one-shot CLI path lives in bin/dsi.mjs
 * (Wave 4); the route only ever needs the bounce.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function dsiBinPath(): string {
	return process.env.DSI_BIN || join(process.cwd(), 'bin', 'dsi.mjs');
}

/** Where the detached chain's stdout/stderr land (RCA 2026-09-27): a
 *  bounce that dies at preflight used to vanish with stdio 'ignore'. The
 *  log is cwd-relative like dsiBinPath (the DSI checkout's tmp/, which
 *  .gitignore's *.log already covers); DSI_BOUNCE_LOG overrides. */
export function bounceLogPath(): string {
	return process.env.DSI_BOUNCE_LOG || join(process.cwd(), 'tmp', 'bounce.log');
}

/** Test seam: the actual spawn, swappable so route tests never fork a process. */
export type ChainSpawner = (node: string, bin: string, args: string[]) => void;
const defaultSpawner: ChainSpawner = (node, bin, args) => {
	const log = bounceLogPath();
	mkdirSync(dirname(log), { recursive: true });
	appendFileSync(log, '[' + new Date().toISOString() + '] bounce spawn: dsi ' + bin.split('/').slice(-2).join('/') + ' ' + args.join(' ') + '\n');
	const out = openSync(log, 'a');
	try {
		const child = spawn(node, [bin, ...args], { detached: true, stdio: ['ignore', out, out] });
		child.unref();
	} finally {
		closeSync(out);
	}
};
let spawner: ChainSpawner = defaultSpawner;
export function setChainSpawner(next: ChainSpawner | null): void {
	spawner = next ?? defaultSpawner;
}

/** @returns false when the bin is missing (route answers honestly; the
 *  operator restarts by hand — never a half-truth 200). When the serving
 *  floor is a DEV floor (DSI_DEV=1, set by startDsiDevServer), the chain
 *  re-serves --dev too (RCA 2026-09-27: a dev pair bounced into build mode
 *  left the browser staring at 5175's corpse). */
export function spawnRestartChain(): boolean {
	const bin = dsiBinPath();
	if (!existsSync(bin)) return false;
	const args = ['dsh', '--plugin-restart'];
	if (process.env.DSI_DEV === '1') args.push('--dev');
	spawner(process.execPath, bin, args);
	return true;
}
