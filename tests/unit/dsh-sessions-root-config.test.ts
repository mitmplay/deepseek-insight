/**
 * readDshSessionsRootConfig tests (Task 1.2-T, spec "2026-09-14 - The
 * Session Full Path") — ADR D3 precedence: env DSI_SESSIONS_ROOT wins;
 * else dsh.sessionsRoot (string-gated); else ~/.dsh/sessions. Non-string
 * values are ignored (never guessed). No cache — edits visible next read.
 *
 * Node env (environmentMatchGlobs) — server-only module.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	DEFAULT_DSH_SESSIONS_ROOT,
	readDshSessionsRootConfig
} from '$lib/server/insight-config.js';

let path: string;

beforeEach(() => {
	path = join(mkdtempSync(join(tmpdir(), 'dsi-sessions-root-')), 'settings.yaml');
});

afterEach(() => {
	delete process.env.DSI_SESSIONS_ROOT;
});

function writeYaml(text: string): void {
	writeFileSync(path, text, 'utf-8');
}

describe('readDshSessionsRootConfig', () => {
	it('env DSI_SESSIONS_ROOT wins over the file', () => {
		writeYaml('dsh:\n  sessionsRoot: /from/yaml\n');
		process.env.DSI_SESSIONS_ROOT = '/from/env';
		expect(readDshSessionsRootConfig(path)).toEqual({ sessionsRoot: '/from/env' });
	});

	it('yaml dsh.sessionsRoot wins when no env', () => {
		writeYaml('dsh:\n  sessionsRoot: /from/yaml\n');
		expect(readDshSessionsRootConfig(path)).toEqual({ sessionsRoot: '/from/yaml' });
	});

	it('defaults to ~/.dsh/sessions when neither is set', () => {
		expect(readDshSessionsRootConfig(path)).toEqual({
			sessionsRoot: join(homedir(), '.dsh', 'sessions')
		});
		expect(DEFAULT_DSH_SESSIONS_ROOT).toBe(join(homedir(), '.dsh', 'sessions'));
	});

	it('non-string sessionsRoot is ignored → default (never guessed)', () => {
		for (const bad of ['42', 'true', '{a: 1}', '[1, 2]', "''"]) {
			writeYaml(`dsh:\n  sessionsRoot: ${bad}\n`);
			expect(readDshSessionsRootConfig(path)).toEqual({
				sessionsRoot: join(homedir(), '.dsh', 'sessions')
			});
		}
	});

	it('empty-string env is ignored (falls through to the file)', () => {
		writeYaml('dsh:\n  sessionsRoot: /from/yaml\n');
		process.env.DSI_SESSIONS_ROOT = '';
		expect(readDshSessionsRootConfig(path)).toEqual({ sessionsRoot: '/from/yaml' });
	});

	it('no cache — an edit between reads is visible on the next read', () => {
		writeYaml('dsh:\n  sessionsRoot: /first\n');
		expect(readDshSessionsRootConfig(path).sessionsRoot).toBe('/first');
		writeYaml('dsh:\n  sessionsRoot: /second\n');
		expect(readDshSessionsRootConfig(path).sessionsRoot).toBe('/second');
	});
});
