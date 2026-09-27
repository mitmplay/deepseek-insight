/**
 * plugin-rack — the detached restart-chain spawn (ADR D5). The apply route
 * calls this AFTER the engine's dsh work is done: the chain is the
 * RESTART-ONLY half (killOrphans + dsi dsh --sync: token re-sync + re-serve),
 * spawned detached + unref so the HTTP response comes home before the floor
 * goes down. The install+restart one-shot CLI path lives in bin/dsi.mjs
 * (Wave 4); the route only ever needs the bounce.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function dsiBinPath(): string {
	return process.env.DSI_BIN || join(process.cwd(), 'bin', 'dsi.mjs');
}

/** Test seam: the actual spawn, swappable so route tests never fork a process. */
export type ChainSpawner = (node: string, bin: string, args: string[]) => void;
let spawner: ChainSpawner = (node, bin, args) => {
	const child = spawn(node, [bin, ...args], { detached: true, stdio: 'ignore' });
	child.unref();
};
export function setChainSpawner(next: ChainSpawner | null): void {
	spawner = next ?? ((node, bin, args) => {
		const child = spawn(node, [bin, ...args], { detached: true, stdio: 'ignore' });
		child.unref();
	});
}

/** @returns false when the bin is missing (route answers honestly; the
 *  operator restarts by hand — never a half-truth 200). */
export function spawnRestartChain(): boolean {
	const bin = dsiBinPath();
	if (!existsSync(bin)) return false;
	spawner(process.execPath, bin, ['dsh', '--plugin-restart']);
	return true;
}
