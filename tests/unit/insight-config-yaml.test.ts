/**
 * insight-config YAML-home tests (Task 1.3-T) — the renamed settings
 * home: YAML fixtures per section, invalid values fall back, and the
 * no-cache contract picks up edits between reads.
 * Node env (environmentMatchGlobs) — server-only module.
 *
 * Spec: dev/specs/2026-09-07 - DSI Settings Panel (ADR D1/D2; Tasks
 * 1.3/1.3-T).
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
	DEFAULT_CHAT_CONFIG,
	DEFAULT_PANEL_CONFIG,
	DEFAULT_SERVER_CONFIG,
	readChatConfig,
	readPanelConfig,
	readServerConfig,
	readSidebarConfig,
	readSettingsHomes
} from '$lib/server/insight-config.js';

let dir: string;
let path: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'dsi-insight-yaml-'));
	path = join(dir, 'settings.yaml');
	delete process.env.DSI_CONFIG_PATH;
});

function writeYaml(text: string): void {
	writeFileSync(path, text, 'utf-8');
}

describe('sections over a YAML home', () => {
	it('reads chat, server, panel, and sidebar sections from YAML', () => {
		writeYaml([
			'chat:',
			'  input:',
			'    maxRows: 40',
			'  accessConfirmTimeoutMs: 3000',
			'  macro:',
			'    maxLines: 50',
			'    maxDepth: 5',
			'server:',
			'  ringCapacity: 900',
			'panel:',
			'  defaultWidth: 700',
			'  minWidth: 500',
			'  maxWidth: 900',
			'sidebar:',
			'  placement: panels-zoom',
			''
		].join('\n'));
		expect(readChatConfig(path)).toEqual({
			input: { maxRows: 40 },
			accessConfirmTimeoutMs: 3000,
			macro: { maxLines: 50, maxDepth: 5 }
		});
		expect(readServerConfig(path)).toEqual({ ringCapacity: 900 });
		expect(readPanelConfig(path).defaultWidth).toBe(700);
		expect(readSidebarConfig(path).placement).toBe('panels-zoom');
	});

	it('out-of-range values still clamp/fall back over YAML', () => {
		writeYaml('chat:\n  input:\n    maxRows: 99999\nserver:\n  ringCapacity: 2\npanel:\n  minZoom: 99\n');
		// intWithin falls back to the DEFAULT on out-of-range (no clamp-to-edge)
		expect(readChatConfig(path).input.maxRows).toBe(DEFAULT_CHAT_CONFIG.input.maxRows);
		expect(readServerConfig(path).ringCapacity).toBe(DEFAULT_SERVER_CONFIG.ringCapacity);
		expect(readPanelConfig(path).minZoom).toBe(DEFAULT_PANEL_CONFIG.minZoom);
	});

	it('missing file falls back to defaults', () => {
		expect(readChatConfig(path)).toEqual(DEFAULT_CHAT_CONFIG);
	});

	it('invalid YAML falls back to defaults', () => {
		writeYaml('chat: [unclosed\n');
		expect(readChatConfig(path)).toEqual(DEFAULT_CHAT_CONFIG);
	});

	it('no cache — an edit between reads is visible on the next read', () => {
		writeYaml('server:\n  ringCapacity: 400\n');
		expect(readServerConfig(path).ringCapacity).toBe(400);
		writeYaml('server:\n  ringCapacity: 800\n');
		expect(readServerConfig(path).ringCapacity).toBe(800);
	});

	// ── settingsHomes (The Settings Tree ADR 2026-09-18 D2) — replaces the
	// retired workspace.layout reader tests: the homes are read-only facts,
	// the layout knob is deleted (D1).

	it('readSettingsHomes returns the two home roots and reads no file', () => {
		expect(readSettingsHomes().dsi.endsWith('/.dsi')).toBe(true);
		expect(readSettingsHomes().dsh.endsWith('/.dsh')).toBe(true);
	});

	it('migration runs on read: legacy config.json converts before parsing', () => {
		writeFileSync(join(dir, 'config.json'), JSON.stringify({ server: { ringCapacity: 650 } }), 'utf-8');
		expect(readServerConfig(path).ringCapacity).toBe(650);
	});
});
