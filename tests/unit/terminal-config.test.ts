/**
 * Terminal config reader tests (Wave 1, task 1.3-T) — the same temp-file
 * seam the insight-config suite uses: every case drives readTerminalConfig
 * through an explicit configPath, never the real ~/.dsi. Defaults carry the
 * reader on missing file / missing section / invalid values; bounds clamp.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TERMINAL_CONFIG, readTerminalConfig } from '$lib/server/insight-config';

let dir: string;
let path: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'dsi-terminal-config-'));
	path = join(dir, 'settings.yaml');
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function writeSection(body: string): void {
	writeFileSync(path, body, 'utf-8');
}

describe('readTerminalConfig', () => {
	it('returns defaults on missing file (enabled stays false)', () => {
		expect(readTerminalConfig(join(dir, 'absent.yaml'))).toEqual(DEFAULT_TERMINAL_CONFIG);
		expect(DEFAULT_TERMINAL_CONFIG.enabled).toBe(false);
	});

	it('returns defaults on a config without the terminal section', () => {
		writeSection('home:\n  refreshMs: 1000\n');
		expect(readTerminalConfig(path)).toEqual(DEFAULT_TERMINAL_CONFIG);
	});

	it('reads a fully specified section', () => {
		writeSection(
			'terminal:\n' +
				'  enabled: true\n' +
				'  tailBytes: 131072\n' +
				'  spillMaxBytes: 1048576\n' +
				'  graceMs: 500\n' +
				'  idleMs: 250\n'
		);
		const cfg = readTerminalConfig(path);
		expect(cfg.enabled).toBe(true);
		expect(cfg.tailBytes).toBe(131_072);
		expect(cfg.spillMaxBytes).toBe(1_048_576);
		expect(cfg.graceMs).toBe(500);
		expect(cfg.idleMs).toBe(250);
	});

	it('invalid or out-of-bounds values fall back per field, valid neighbors survive', () => {
		writeSection(
			'terminal:\n' +
				'  enabled: yes-please\n' +
				'  tailBytes: 12\n' +
				'  graceMs: 999999\n' +
				'  idleMs: 250\n'
		);
		const cfg = readTerminalConfig(path);
		expect(cfg.enabled).toBe(false);
		expect(cfg.tailBytes).toBe(DEFAULT_TERMINAL_CONFIG.tailBytes);
		expect(cfg.graceMs).toBe(DEFAULT_TERMINAL_CONFIG.graceMs);
		expect(cfg.idleMs).toBe(250);
	});

	it('boolean enabled accepts only real booleans', () => {
		writeSection('terminal:\n  enabled: "true"\n');
		expect(readTerminalConfig(path).enabled).toBe(false);
		writeSection('terminal:\n  enabled: false\n');
		expect(readTerminalConfig(path).enabled).toBe(false);
		writeSection('terminal:\n  enabled: true\n');
		expect(readTerminalConfig(path).enabled).toBe(true);
	});
});

describe('readTerminalConfig — maxSessions (Terminal Desk ADR D6, Wave 4, task 4.2-T)', () => {
	it('defaults to 8 and bounds to [1, 32]', () => {
		expect(DEFAULT_TERMINAL_CONFIG.maxSessions).toBe(8);
		writeSection('terminal:\n  maxSessions: 0\n');
		expect(readTerminalConfig(path).maxSessions).toBe(8); // out of range → fallback (intWithin semantics)
		writeSection('terminal:\n  maxSessions: 99\n');
		expect(readTerminalConfig(path).maxSessions).toBe(8); // out of range → fallback
		writeSection('terminal:\n  maxSessions: 3\n');
		expect(readTerminalConfig(path).maxSessions).toBe(3); // in range → honored
		writeSection('terminal:\n  maxSessions: \'many\'\n');
		expect(readTerminalConfig(path).maxSessions).toBe(8); // junk → default
	});
});

