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

const spawnMock = vi.fn(() => ({ unref: vi.fn() }));

vi.mock('node:child_process', () => ({
	spawn: (...args: unknown[]) => spawnMock(...args)
}));

import { dsiBinPath, setChainSpawner, spawnRestartChain } from '../../src/lib/server/plugins/restart-chain';

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
	it('a null spawner resets to the real detached spawn + unref', () => {
		setChainSpawner(null);
		process.env.DSI_BIN = fakeBin;
		expect(spawnRestartChain()).toBe(true);
		expect(spawnMock).toHaveBeenCalledTimes(1);
		const [node, argv, opts] = spawnMock.mock.calls[0] as [string, string[], { detached: boolean; stdio: string }];
		expect(node).toBe(process.execPath);
		expect(argv).toEqual([fakeBin, 'dsh', '--plugin-restart']);
		expect(opts).toEqual({ detached: true, stdio: 'ignore' });
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
});
