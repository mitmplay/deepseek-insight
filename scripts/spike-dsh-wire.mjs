#!/usr/bin/env node
/**
 * spike-dsh-wire.mjs — CLI wrapper around the DSH live wire spike (task 1.4).
 *
 * Usage:
 *   DSH_LIVE=1 node scripts/spike-dsh-wire.mjs          # full spike (default)
 *   DSH_LIVE=1 node scripts/spike-dsh-wire.mjs --check   # reachability only
 *
 * Exit codes: 0 = green (or clean skip when DSH_LIVE unset), 1 = failure.
 */

import { spawnSync } from 'node:child_process';

const checkOnly = process.argv.includes('--check');
const env = { ...process.env, DSH_LIVE: '1' };

if (checkOnly) {
	// Quick reachability probe without vitest
	try {
		const base = env.DSH_BASE_URL ?? 'http://127.0.0.1:3080';
		const res = await fetch(`${base}/api/session.list`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ type: 'client-request', rpcId: 'spike-check', method: 'session.list', payload: {} }),
			signal: AbortSignal.timeout(3000)
		});
		if (res.status === 200) {
			console.log(`[spike-dsh-wire] host reachable at ${base} — session.list answered 200`);
			process.exit(0);
		}
		console.error(`[spike-dsh-wire] host answered HTTP ${res.status} at ${base}`);
		process.exit(1);
	} catch (err) {
		console.error(`[spike-dsh-wire] host unreachable: ${err}`);
		process.exit(1);
	}
}

console.log('[spike-dsh-wire] running live wire spike via vitest (DSH_LIVE=1)…');
const run = spawnSync('npx', ['vitest', 'run', 'tests/live/wire-spike.test.ts'], {
	env,
	stdio: 'inherit'
});
process.exit(run.status ?? 1);
