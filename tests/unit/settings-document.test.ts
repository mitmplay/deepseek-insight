/**
 * settings-document tests (Task 1.2-T) — the module's binding contracts:
 * one-time migration (legacy untouched, never runs twice), fresh start,
 * raw read, parse-gated atomic save, per-target path resolution.
 * Node env (environmentMatchGlobs) — the module is server-only.
 *
 * Spec: dev/specs/2026-09-07 - DSI Settings Panel (ADR D1/D2/D5;
 * Tasks 1.2/1.2-T).
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	DSH_SETTINGS_PATH,
	DSI_SETTINGS_PATH,
	SettingsParseError,
	migrateLegacyDsiConfig,
	parseYamlSettings,
	readSettingsDocument,
	resolveSettingsPath,
	saveSettingsDocument
} from '$lib/server/settings-document.js';

let tmpRoot: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), 'dsi-settings-doc-'));
	delete process.env.DSI_CONFIG_PATH;
	delete process.env.DSH_SETTINGS_PATH;
});

afterEach(() => {
	delete process.env.DSI_CONFIG_PATH;
	delete process.env.DSH_SETTINGS_PATH;
});

describe('path resolution', () => {
	it('defaults to the two homes', () => {
		expect(DSI_SETTINGS_PATH.endsWith(join('.dsi', 'settings.yaml'))).toBe(true);
		expect(DSH_SETTINGS_PATH.endsWith(join('.dsh', 'settings.yaml'))).toBe(true);
	});
	it('resolveSettingsPath maps each target', () => {
		expect(resolveSettingsPath('dsi', join(tmpRoot, 'a.yaml'))).toBe(join(tmpRoot, 'a.yaml'));
		expect(resolveSettingsPath('dsh', join(tmpRoot, 'b.yaml'))).toBe(join(tmpRoot, 'b.yaml'));
	});
	it('env overrides win over defaults', () => {
		process.env.DSI_CONFIG_PATH = join(tmpRoot, 'env-dsi.yaml');
		process.env.DSH_SETTINGS_PATH = join(tmpRoot, 'env-dsh.yaml');
		expect(resolveSettingsPath('dsi')).toBe(join(tmpRoot, 'env-dsi.yaml'));
		expect(resolveSettingsPath('dsh')).toBe(join(tmpRoot, 'env-dsh.yaml'));
	});
});

describe('one-time migration (ADR D1)', () => {
	it('converts legacy config.json to settings.yaml and never touches the legacy file', () => {
		const legacy = { chat: { input: { maxRows: 9 } }, panel: { defaultWidth: 700 } };
		writeFileSync(join(tmpRoot, 'config.json'), JSON.stringify(legacy), 'utf-8');
		const legacyBefore = readFileSync(join(tmpRoot, 'config.json'), 'utf-8');
		const settingsPath = join(tmpRoot, 'settings.yaml');

		migrateLegacyDsiConfig(settingsPath);

		expect(existsSync(settingsPath)).toBe(true);
		const converted = readFileSync(settingsPath, 'utf-8');
		expect(converted).toContain('maxRows: 9');
		expect(converted).not.toContain('{');
		// legacy file untouched, byte for byte
		expect(readFileSync(join(tmpRoot, 'config.json'), 'utf-8')).toBe(legacyBefore);
	});

	it('never runs twice — a second resolve no-ops and keeps the saved edits', () => {
		writeFileSync(join(tmpRoot, 'config.json'), JSON.stringify({ home: { refreshMs: 999 } }), 'utf-8');
		const settingsPath = join(tmpRoot, 'settings.yaml');
		migrateLegacyDsiConfig(settingsPath);
		// operator edits the new home; legacy still exists
		writeFileSync(settingsPath, 'home:\n  refreshMs: 1234\n', 'utf-8');
		migrateLegacyDsiConfig(settingsPath);
		expect(readFileSync(settingsPath, 'utf-8')).toBe('home:\n  refreshMs: 1234\n');
	});

	it('skips silently when the legacy file is unreadable JSON', () => {
		writeFileSync(join(tmpRoot, 'config.json'), '{not json', 'utf-8');
		const settingsPath = join(tmpRoot, 'settings.yaml');
		migrateLegacyDsiConfig(settingsPath);
		expect(existsSync(settingsPath)).toBe(false);
	});

	it('no-ops on fresh start (no files at all)', () => {
		const settingsPath = join(tmpRoot, 'settings.yaml');
		migrateLegacyDsiConfig(settingsPath);
		expect(existsSync(settingsPath)).toBe(false);
	});
});

describe('readSettingsDocument', () => {
	it('returns missing honestly when the file is absent', () => {
		const r = readSettingsDocument('dsi', join(tmpRoot, 'settings.yaml'));
		expect(r).toEqual({ text: '', missing: true });
	});

	it('returns raw text when present, migrating first for dsi only', () => {
		writeFileSync(join(tmpRoot, 'config.json'), JSON.stringify({ home: { refreshMs: 777 } }), 'utf-8');
		const r = readSettingsDocument('dsi', join(tmpRoot, 'settings.yaml'));
		expect(r.missing).toBe(false);
		expect(r.text).toContain('refreshMs: 777');
	});

	it('dsh target never migrates', () => {
		writeFileSync(join(tmpRoot, 'config.json'), JSON.stringify({ a: 1 }), 'utf-8');
		const r = readSettingsDocument('dsh', join(tmpRoot, 'settings.yaml'));
		expect(r.missing).toBe(true);
		expect(existsSync(join(tmpRoot, 'settings.yaml'))).toBe(false);
	});
});

describe('saveSettingsDocument (ADR D5 parse gate)', () => {
	it('writes valid YAML atomically and it reads back verbatim', () => {
		const path = join(tmpRoot, 'settings.yaml');
		saveSettingsDocument('dsh', 'server:\n  ringCapacity: 600\n', path);
		expect(readSettingsDocument('dsh', path).text).toBe('server:\n  ringCapacity: 600\n');
	});

	it('rejects invalid YAML with line and column, writing nothing', () => {
		const path = join(tmpRoot, 'settings.yaml');
		let err: unknown;
		try {
			saveSettingsDocument('dsi', 'chat:\n  input: [unclosed\n', path);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(SettingsParseError);
		const spe = err as SettingsParseError;
		expect(typeof spe.message).toBe('string');
		expect(spe.line).not.toBeNull();
		expect(existsSync(path)).toBe(false);
	});

	it('creates the directory when saving to a fresh home', () => {
		const path = join(tmpRoot, 'nested', 'dir', 'settings.yaml');
		saveSettingsDocument('dsi', 'home:\n  refreshMs: 5000\n', path);
		expect(existsSync(path)).toBe(true);
	});
});

describe('parseYamlSettings', () => {
	it('null on empty and whitespace-only documents', () => {
		expect(parseYamlSettings('')).toBeNull();
		expect(parseYamlSettings('   \n\t  ')).toBeNull();
	});

	it('parses a valid record through', () => {
		expect(parseYamlSettings('home:\n  refreshMs: 5000\n')).toEqual({ home: { refreshMs: 5000 } });
		// JSON is a YAML subset — the same parse serves both shapes.
		expect(parseYamlSettings('{"panel":{"defaultWidth":700}}')).toEqual({ panel: { defaultWidth: 700 } });
	});

	it('null on a parsed non-record (scalar or sequence)', () => {
		expect(parseYamlSettings('just a scalar')).toBeNull();
		expect(parseYamlSettings('- a\n- b\n')).toBeNull();
	});

	it('null on syntactically invalid YAML', () => {
		expect(parseYamlSettings('a: b\n\tc: [unclosed\n')).toBeNull();
	});
});
