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

import { bounceLogPath, dsiBinPath, setChainSpawner, spawnRestartChain } from '../../src/lib/server/plugins/restart-chain';

const sandbox = mkdtempSync(join(tmpdir(), 'dsi-restart-chain-'));
const fakeBin = join(sandbox, 'dsi.mjs');
const missingBin = join(sandbox, 'nope.mjs');

let savedBin: string | undefined;

beforeEach(() => {
	spawnMock.mockClear();
	savedBin = process.env.DSI_BIN;
	writeFileSync(fakeBin, '#!/bin/sh');
});

afterEach(() => {
	if (savedBin === undefined) delete process.env.DSI_BIN;
	else process.env.DSI_BIN = savedBin;
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
		expect(spawnMock).toHaveBeenCalledTimes(1);
		const [node, argv, opts] = spawnMock.mock.calls[0] as unknown as [string, string[], { detached: boolean; stdio: [string, number, number] }];
		expect(node).toBe(process.execPath);
		expect(argv).toEqual([fakeBin, 'dsh', '--plugin-restart']);
		expect(opts.detached).toBe(true);
		// stdout+stderr ride the appended log fd; stdin stays dead.
		expect(opts.stdio[0]).toBe('ignore');
		expect(opts.stdio[1]).toBe(7);
		expect(opts.stdio[2]).toBe(7);
		expect(appendFileSyncMock).toHaveBeenCalledTimes(1);
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
		try {
			const seen: Array<{ args: string[] }> = [];
			setChainSpawner((_node, _bin, args) => seen.push({ args }));
			expect(spawnRestartChain()).toBe(true);
			expect(seen).toEqual([{ args: ['dsh', '--plugin-restart', '--dev'] }]);
		} finally {
			delete process.env.DSI_DEV;
		}
	});
});
