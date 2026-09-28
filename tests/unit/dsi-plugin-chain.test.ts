/**
 * Task 4.1-T — the launch chain's testable half (bin/lib/plugin-chain.mjs):
 * argument validation exits 64 shapes, launcher-rule command construction
 * (DSH_WEB_CMD override, else the pinned npx), and the dsi.mjs flag surface
 * smoke (spawn, never a live floor).
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bounceDevMode, dshLauncherCmd, parsePluginArgs } from '../../bin/lib/plugin-chain.mjs';

const BIN = resolve(import.meta.dirname, '../../bin/dsi.mjs');

type Parsed = ReturnType<typeof parsePluginArgs>;

function mustParse(argv: string[], options?: { envProfile?: string }): NonNullable<Extract<Parsed, { action: string }>> {
	const r = parsePluginArgs(argv, options);
	if (r === null || !('action' in r)) throw new Error('expected a parsed invocation: ' + JSON.stringify(r));
	return r;
}

function mustFail(argv: string[]): string {
	const r = parsePluginArgs(argv);
	if (r === null || !('error' in r)) throw new Error('expected a usage error: ' + JSON.stringify(r));
	return r.error;
}

describe('parsePluginArgs', () => {
	it('null for non-plugin invocations (caller falls through)', () => {
		expect(parsePluginArgs(['--sync'])).toBeNull();
		expect(parsePluginArgs(['--token', 'abc'])).toBeNull();
	});
	it('parses add with an explicit profile', () => {
		expect(mustParse(['--plugin', 'add', 'git+https://x/y.git', '--profile', 'dev'])).toEqual({
			action: 'add', pkg: 'git+https://x/y.git', profile: 'dev'
		});
	});
	it('defaults the profile to web (env-seamable)', () => {
		expect(mustParse(['--plugin', 'remove', 'some-pkg'])).toEqual({
			action: 'remove', pkg: 'some-pkg', profile: 'web'
		});
		expect(mustParse(['--plugin', 'remove', 'some-pkg'], { envProfile: 'dev' }).profile).toBe('dev');
	});
	it('restart flag takes no arguments', () => {
		expect(mustParse(['--plugin-restart'])).toMatchObject({ action: 'restart' });
		expect(mustFail(['--plugin-restart', 'extra'])).toContain('usage');
	});
	it('restart accepts --dev and records it (RCA 2026-09-27: the bounce must restore the dev floor)', () => {
		expect(mustParse(['--plugin-restart']).dev).toBe(false);
		expect(mustParse(['--plugin-restart', '--dev']).dev).toBe(true);
		expect(mustFail(['--plugin-restart', '--dev', 'stray'])).toContain('usage');
	});
	it('bad shapes error with the usage line', () => {
		expect(mustFail(['--plugin'])).toContain('usage');
		expect(mustFail(['--plugin', 'bogus', 'x'])).toContain('usage');
		expect(mustFail(['--plugin', 'add', '--profile'])).toContain('usage');
		expect(mustFail(['--plugin', 'add', 'x', 'stray'])).toContain('unexpected argument');
	});
});

describe('bounceDevMode (RCA 2026-09-27, second order)', () => {
	it('an explicit --dev wins without asking the process table', () => {
		let asked = 0;
		expect(bounceDevMode(true, () => { asked++; return false; })).toBe(true);
		expect(asked).toBe(0);
	});
	it('no flag: a live dev floor (pgrep probe hits) bounces back as dev', () => {
		expect(bounceDevMode(false, () => true)).toBe(true);
	});
	it('no flag, no dev floor: production bounce (the 5174-only regression)', () => {
		expect(bounceDevMode(false, () => false)).toBe(false);
	});
	it('a throwing probe reads as production — the bounce still happens', () => {
		expect(bounceDevMode(false, () => { throw new Error('pgrep missing'); })).toBe(false);
	});
});

describe('dshLauncherCmd', () => {
	it('delegates to the pinned npx dsh by default', () => {
		expect(dshLauncherCmd('web', 'add', 'git+https://x/y.git', '1.2.3')).toBe(
			'npx --yes @deepseek-ai/dsh@1.2.3 plugin --profile web add git+https://x/y.git'
		);
	});
	it('DSH_WEB_CMD overrides the launcher', () => {
		process.env.DSH_WEB_CMD = 'dsh-from-source';
		expect(dshLauncherCmd('web', 'remove', 'pkg', '1.2.3')).toBe('dsh-from-source plugin --profile web remove pkg');
		delete process.env.DSH_WEB_CMD;
	});
});

describe('dsi.mjs flag surface (smoke — spawns the real CLI, no floor)', () => {
	const run = (args: string[]) => spawnSync(process.execPath, [BIN, 'dsh', ...args], { encoding: 'utf8' });
	it('a malformed --plugin usage exits 64 with the usage line', () => {
		const r = run(['--plugin']);
		expect(r.status).toBe(64);
		expect(r.stderr).toContain('usage: dsi dsh --plugin');
	});
	it('--plugin-restart with a stray argument exits 64', () => {
		expect(run(['--plugin-restart', 'extra']).status).toBe(64);
	});
	it('--help still lists the plugin verbs', () => {
		const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
		expect(r.stdout).toContain('--plugin add');
		expect(r.stdout).toContain('--plugin-restart');
	});
});
