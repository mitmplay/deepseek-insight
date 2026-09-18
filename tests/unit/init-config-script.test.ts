/**
 * init-config script tests (Task 1.4-T) — create and merge behaviors
 * target ~/.dsi/settings.yaml (via the DSI_CONFIG_PATH seam) and
 * never touch legacy config.json.
 * Node env (environmentMatchGlobs) — spawns the script as a subprocess.
 *
 * Spec: dev/specs/2026-09-07 - DSI Settings Panel (Tasks 1.4/1.4-T).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts', 'init-config.mjs');

let dir: string;
let settingsPath: string;

function runScript(): void {
	execFileSync('node', [SCRIPT], {
		env: { ...process.env, DSI_CONFIG_PATH: settingsPath },
		stdio: 'pipe'
	});
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'dsi-init-config-'));
	settingsPath = join(dir, 'settings.yaml');
});

describe('init-config over the YAML home', () => {
	it('creates settings.yaml with defaults when absent', () => {
		runScript();
		expect(existsSync(settingsPath)).toBe(true);
		const doc = parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
		expect(typeof doc.chat).toBe('object');
		expect(doc.chat).toBeDefined();
		// YAML document format, not JSON (empty sections render as {} inline)
		expect(readFileSync(settingsPath, 'utf-8').startsWith('{')).toBe(false);
	});

	it('merges missing keys and keeps existing values', () => {
		writeFileSync(settingsPath, 'chat:\n  input:\n    maxRows: 33\n', 'utf-8');
		runScript();
		const doc = parse(readFileSync(settingsPath, 'utf-8')) as {
			chat: { input: { maxRows: number } };
			server?: unknown;
		};
		expect(doc.chat.input.maxRows).toBe(33);
		expect(doc.server).toBeDefined();
	});

	it('never creates or touches legacy config.json', () => {
		runScript();
		expect(existsSync(join(dir, 'config.json'))).toBe(false);
		writeFileSync(join(dir, 'config.json'), '{"stale":true}', 'utf-8');
		runScript();
		expect(readFileSync(join(dir, 'config.json'), 'utf-8')).toBe('{"stale":true}');
	});
});
