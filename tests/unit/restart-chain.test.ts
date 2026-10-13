/**
 * restart-chain unit suite — the detached restart-only spawn (ADR D5):
 * dsiBinPath env/cwd resolution, the setChainSpawner test seam (including
 * reset-to-default), and spawnRestartChain's honest-false when the bin is
 * missing vs. the spawn handoff when it exists.
 */
// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn((..._args: unknown[]) => ({ unref: vi.fn() }));

vi.mock('node:child_process', () => ({
	spawn: (...args: unknown[]) => spawnMock(...args)
}));
// The default spawner journals to the bounce log; pin the fs seam so tests
// never touch a real tmp/ directory.
const openSyncMock = vi.fn((..._a: unknown[]) => 7);
const closeSyncMock = vi.fn((..._a: unknown[]) => undefined);
const mkdirSyncMock = vi.fn((..._a: unknown[]) => undefined);
const appendFileSyncMock = vi.fn((..._a: unknown[]) => undefined);
vi.mock('node:fs', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:fs')>()),
	openSync: (...a: unknown[]) => openSyncMock(...a),
	closeSync: (...a: unknown[]) => closeSyncMock(...a),
	mkdirSync: (...a: unknown[]) => mkdirSyncMock(...a),
	appendFileSync: (...a: unknown[]) => appendFileSyncMock(...a)
}));

import { bounceLogPath, delayedStartArgs, dsiBinPath, setChainSpawner, spawnRestartChain } from '../../src/lib/server/plugins/restart-chain';

const sandbox = mkdtempSync(join(tmpdir(), 'dsi-restart-chain-'));
const fakeBin = join(sandbox, 'dsi.mjs');
const missingBin = join(sandbox, 'nope.mjs');

let savedBin: string | undefined;
// Env hygiene: the test runner itself may live INSIDE a dev floor (the
// in-process host floor exports DSI_DEV=1 into every descendant env), so
// the dev-marker tests must pin the ambient value, not inherit it.
let savedDev: string | undefined;

beforeEach(() => {
	spawnMock.mockClear();
	savedBin = process.env.DSI_BIN;
	savedDev = process.env.DSI_DEV;
	delete process.env.DSI_DEV;
	writeFileSync(fakeBin, '#!/bin/sh');
});

afterEach(() => {
	if (savedBin === undefined) delete process.env.DSI_BIN;
	else process.env.DSI_BIN = savedBin;
	if (savedDev === undefined) delete process.env.DSI_DEV;
	else process.env.DSI_DEV = savedDev;
	setChainSpawner(null);
});

describe('bounceLogPath', () => {
	const savedLog = process.env.DSI_BOUNCE_LOG;
	afterEach(() => {
		if (savedLog === undefined) delete process.env.DSI_BOUNCE_LOG;
		else process.env.DSI_BOUNCE_LOG = savedLog;
	});
	it('falls back to <cwd>/tmp/bounce.log', () => {
		delete process.env.DSI_BOUNCE_LOG;
		expect(bounceLogPath()).toBe(join(process.cwd(), 'tmp', 'bounce.log'));
	});
	it('DSI_BOUNCE_LOG wins when set', () => {
		process.env.DSI_BOUNCE_LOG = '/tmp/elsewhere.log';
		expect(bounceLogPath()).toBe('/tmp/elsewhere.log');
	});
});

describe('dsiBinPath', () => {
	it('DSI_BIN wins when set', () => {
		process.env.DSI_BIN = fakeBin;
		expect(dsiBinPath()).toBe(fakeBin);
	});
	it('falls back to <cwd>/bin/dsi.mjs', () => {
		delete process.env.DSI_BIN;
		expect(dsiBinPath()).toBe(join(process.cwd(), 'bin', 'dsi.mjs'));
	});
});

describe('setChainSpawner', () => {
	it('a null spawner resets to the real detached spawn + unref, journaling to the bounce log', () => {
		setChainSpawner(null);
		process.env.DSI_BIN = fakeBin;
		process.env.DSI_BOUNCE_LOG = join(sandbox, 'bounce.log');
		expect(spawnRestartChain()).toBe(true);
		expect(spawnMock).toHaveBeenCalledTimes(2); // the chain + the delayed re-serve guard (Port Takeover)
		const [node, argv, opts] = spawnMock.mock.calls[0] as unknown as [string, string[], { detached: boolean; stdio: [string, number, number] }];
		expect(node).toBe(process.execPath);
		expect(argv).toEqual([fakeBin, 'dsh', '--plugin-restart']);
		expect(opts.detached).toBe(true);
		// stdout+stderr ride the appended log fd; stdin stays dead.
		expect(opts.stdio[0]).toBe('ignore');
		expect(opts.stdio[1]).toBe(7);
		expect(opts.stdio[2]).toBe(7);
		// the delayed re-serve: its own detached session, port-guarded, logging aside
		const [sh, shArgs, shOpts] = spawnMock.mock.calls[1] as unknown as [string, string[], { detached: boolean; stdio: string }];
		expect(sh).toBe('/bin/sh');
		expect(shArgs[0]).toBe('-c');
		expect(shArgs[1]).toContain('sleep 5');
		expect(shArgs[1]).toContain('lsof -ti tcp:3080');
		// Faithful Bounce (ADR 2026-10-13): no dev stamps in this test's env →
		// the delayed re-serve restores BUILD (never the old hardcoded in-process).
		expect(shArgs[1]).toContain('"dsh" "--sync" >> ');
		expect(shArgs[1]).not.toContain('"--dev"');
		// the receipt names the restored shape (D5)
		const journalCalls = appendFileSyncMock.mock.calls.map((c) => String(c[1]));
		expect(journalCalls.some((line) => line.includes('delayed re-serve armed') && line.includes('mode=build') && line.includes('inspect=none'))).toBe(true);
		expect(shOpts.detached).toBe(true);
		expect(shOpts.stdio).toBe('ignore');
		expect(appendFileSyncMock).toHaveBeenCalledTimes(3); // marker + env keys + delayed-armed line
		expect(closeSyncMock).toHaveBeenCalledWith(7);
		delete process.env.DSI_BOUNCE_LOG;
	});
});

describe('spawnRestartChain', () => {
	it('answers honestly false when the bin is missing — no spawn', () => {
		process.env.DSI_BIN = missingBin;
		let calls = 0;
		setChainSpawner(() => { calls++; });
		expect(spawnRestartChain()).toBe(false);
		expect(calls).toBe(0);
	});
	it('spawns the restart chain through the seam and returns true', () => {
		process.env.DSI_BIN = fakeBin;
		const seen: Array<{ node: string; bin: string; args: string[] }> = [];
		setChainSpawner((node, bin, args) => seen.push({ node, bin, args }));
		expect(spawnRestartChain()).toBe(true);
		expect(seen).toEqual([{ node: process.execPath, bin: fakeBin, args: ['dsh', '--plugin-restart'] }]);
	});
	it('a dev floor (DSI_DEV=1) bounces back as --dev (RCA 2026-09-27)', () => {
		process.env.DSI_BIN = fakeBin;
		process.env.DSI_DEV = '1';
		const seen: Array<{ args: string[] }> = [];
		setChainSpawner((_node, _bin, args) => seen.push({ args }));
		expect(spawnRestartChain()).toBe(true);
		expect(seen).toEqual([{ args: ['dsh', '--plugin-restart', '--dev'] }]);
	});
});

// delayedStartArgs — the faithful delayed re-serve builder (ADR 2026-10-13
// "The Faithful Bounce", D2/D5): the launch record lives in the chain's
// inherited env; every mode x inspect permutation must come back as launched.
describe('delayedStartArgs (launch record → start command)', () => {
	it('an in-process floor restores --dev in-process', () => {
		expect(delayedStartArgs({ DSI_DEV: '1', DSI_DEV_MODE: 'in-process' })).toEqual({
			mode: 'in-process', inspectArgs: [], startArgs: ['dsh', '--sync', '--dev', 'in-process']
		});
	});
	it('a pair floor (bare --dev, pre-D6 marker absent) restores --dev', () => {
		expect(delayedStartArgs({ DSI_DEV: '1' })).toEqual({
			mode: 'pair', inspectArgs: [], startArgs: ['dsh', '--sync', '--dev']
		});
		expect(delayedStartArgs({ DSI_DEV: '1', DSI_DEV_MODE: 'pair' }).startArgs).toEqual(['dsh', '--sync', '--dev']);
	});
	it('a build floor (no stamps) restores plain --sync — and still arms (D4)', () => {
		expect(delayedStartArgs({})).toEqual({ mode: 'build', inspectArgs: [], startArgs: ['dsh', '--sync'] });
	});
	it.each([
		['--inspect', ['--inspect']],
		['--inspect-brk', ['--inspect-brk']],
		['--inspect=127.0.0.1:9229', ['--inspect=127.0.0.1:9229']],
		['--inspect --inspect-brk', ['--inspect', '--inspect-brk']]
	])('DSI_INSPECT_ARGS=%s rides back as execArgv', (stamp, expected) => {
		const r = delayedStartArgs({ DSI_DEV: '1', DSI_DEV_MODE: 'in-process', DSI_INSPECT_ARGS: stamp });
		expect(r.inspectArgs).toEqual(expected);
		expect(r.mode).toBe('in-process');
	});
	it('an absent or whitespace-only DSI_INSPECT_ARGS is no flags', () => {
		expect(delayedStartArgs({ DSI_DEV: '1', DSI_INSPECT_ARGS: '' }).inspectArgs).toEqual([]);
		expect(delayedStartArgs({ DSI_DEV: '1', DSI_INSPECT_ARGS: '   ' }).inspectArgs).toEqual([]);
	});
	it('a foreign build marker never yields a dev re-serve even with inspect stamps', () => {
		const r = delayedStartArgs({ DSI_DEV: '0', DSI_DEV_MODE: 'in-process', DSI_INSPECT_ARGS: '--inspect' });
		expect(r.mode).toBe('build');
		expect(r.startArgs).toEqual(['dsh', '--sync']);
	});
});

// The delayed ARM itself (Wave 2, Task 2.1): the /bin/sh guard script must
// carry the faithful command for every launch shape (ADR 2026-10-13, D2).
describe('delayedRestart arm (faithful command via inherited env)', () => {
	function armScript(): string {
		process.env.DSI_BIN = fakeBin;
		process.env.DSI_BOUNCE_LOG = join(sandbox, 'bounce.log');
		setChainSpawner(null); // the real default spawner — spawn is mocked
		expect(spawnRestartChain()).toBe(true);
		const call = spawnMock.mock.calls[1] as unknown as [string, string[], unknown];
		return String(call[1][1]); // ['/c'? no: ['-c', script]] → the script
	}
	afterEach(() => {
		delete process.env.DSI_DEV;
		delete process.env.DSI_DEV_MODE;
		delete process.env.DSI_INSPECT_ARGS;
	});
	it('pair floor → dsh --sync --dev', () => {
		process.env.DSI_DEV = '1';
		process.env.DSI_DEV_MODE = 'pair';
		expect(armScript()).toContain('"dsh" "--sync" "--dev" >> ');
	});
	it('in-process floor → dsh --sync --dev in-process', () => {
		process.env.DSI_DEV = '1';
		process.env.DSI_DEV_MODE = 'in-process';
		expect(armScript()).toContain('"dsh" "--sync" "--dev" "in-process" >> ');
	});
	it('inspector flags lead the node invocation', () => {
		process.env.DSI_DEV = '1';
		process.env.DSI_DEV_MODE = 'in-process';
		process.env.DSI_INSPECT_ARGS = '--inspect=127.0.0.1:9229 --inspect-brk';
		const script = armScript();
		expect(script).toContain('"--inspect=127.0.0.1:9229" "--inspect-brk"');
		// flags land BEFORE the bin (node execArgv order, D7)
		expect(script.indexOf('--inspect=127.0.0.1:9229')).toBeLessThan(script.indexOf('dsi.mjs'));
	});
	it('the journal names mode and inspect (receipt, D5)', () => {
		process.env.DSI_DEV = '1';
		process.env.DSI_DEV_MODE = 'in-process';
		process.env.DSI_INSPECT_ARGS = '--inspect';
		armScript();
		const journalCalls = appendFileSyncMock.mock.calls.map((c) => String(c[1]));
		expect(journalCalls.some((l) => l.includes('mode=in-process') && l.includes('inspect=--inspect'))).toBe(true);
	});
});
