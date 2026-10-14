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
		// Incident forensics (2026-10-12, Port Takeover): the bounced floor's
		// host boot double-binds its own port — the only difference from a
		// working manual boot is this inherited environment. Journal the
		// DSH_/DSI_ keys so a failing bounce names its suspects.
		appendFileSync(log, '[' + new Date().toISOString() + '] chain env keys: ' +
			Object.keys(process.env).filter((k) => k.startsWith('DSH_') || k.startsWith('DSI_')).sort().join(',') + '\n');
	} finally {
		closeSync(out);
	}
	delayedRestart(node, bin, args);
};
/**
 * delayedStartArgs — the faithful delayed re-serve command, derived from the
 * launch record (ADR 2026-10-13 "The Faithful Bounce", D2/D5): the chain
 * inherited the launcher's env stamps at spawn, so the record is read HERE,
 * synchronously — never a hardcoded mode, never a ps probe of a dead floor.
 *   DSI_DEV_MODE=in-process → dsh --sync --dev in-process
 *   DSI_DEV=1 (any other mode) → dsh --sync --dev  (pair; pre-D6 floors)
 *   no dev stamps → dsh --sync  (build — still arms, D4)
 * DSI_INSPECT_ARGS (space-joined inspector flags, stamped by the launcher)
 * rides back as execArgv. Pure: unit-pinned per permutation.
 */
export function delayedStartArgs(env: NodeJS.ProcessEnv): {
	mode: 'build' | 'pair' | 'in-process';
	inspectArgs: string[];
	startArgs: string[];
} {
	const mode = env.DSI_DEV === '1' ? (env.DSI_DEV_MODE === 'in-process' ? 'in-process' : 'pair') : 'build';
	const inspectArgs = (env.DSI_INSPECT_ARGS ?? '').split(/\s+/).filter(Boolean);
	const startArgs = mode === 'build' ? ['dsh', '--sync'] : mode === 'pair' ? ['dsh', '--sync', '--dev'] : ['dsh', '--sync', '--dev', 'in-process'];
	return { mode, inspectArgs, startArgs };
}

/** The delayed re-serve (operator decision, 2026-10-12): the bounced chain's
 *  own boot can still lose its port (production-only double-bind, unresolved).
 *  So AFTER the floor dies we give everything 5s to fully exit, then start
 *  the floor again from a clean slate — UNLESS the chain's own boot won and
 *  the host port is already listening (the guard makes this idempotent).
 *  Runs detached in its own session: survives both the old floor's death and
 *  the chain's exit. DSI_DELAYED_RESTART_SECONDS overrides the 5s. */
const delayedRestart: ChainSpawner = (node, bin) => {
	const log = bounceLogPath();
	const seconds = Number(process.env.DSI_DELAYED_RESTART_SECONDS ?? 5);
	const out = openSync(log, 'a');
	try {
		// Faithful restore (ADR 2026-10-13 "The Faithful Bounce", D2/D5): the
		// command is DERIVED from the chain's inherited env record — never a
		// hardcoded mode. The receipt names mode + inspect BEFORE arming.
		const { mode, inspectArgs, startArgs } = delayedStartArgs(process.env);
		appendFileSync(log, '[' + new Date().toISOString() + '] delayed re-serve armed: ' + seconds + 's mode=' + mode + ' inspect=' + (inspectArgs.length ? inspectArgs.join(' ') : 'none') + ' (skips if port 3080 is already up)\n');
		// Inspector flags ride the dsi CLI ARGS, never node execArgv (fix
		// 2026-10-13): extractInspectArgs (bin/lib/dev-mode.mjs:127) peels them
		// from dsi's argv and leads the VITE child's argv with them — the child
		// that owns the embedded host is the debuggable one. Node-level flags
		// before the bin only ever debugged the dsi parent, leaving the vite
		// process (lens + host) without an inspector after every bounce.
		const startCmd = node + ' ' + JSON.stringify(bin) + ' ' + startArgs.concat(inspectArgs).map((a) => JSON.stringify(a)).join(' ') + ' >> ' + JSON.stringify(join(process.cwd(), 'tmp', 'delayed-start.log')) + ' 2>&1';
		const script = 'sleep ' + seconds + '; ' +
			'if lsof -ti tcp:3080 -sTCP:LISTEN | grep -q .; then echo "[delayed] port 3080 already up — skip"; ' +
			'else cd ' + JSON.stringify(process.cwd()) + ' && ' + startCmd + '; fi';
		const child = spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' });
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
