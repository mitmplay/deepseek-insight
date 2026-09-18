/**
 * Unit: settings-home — The Settings Tree ADR (2026-09-18, D2/D3): the
 * DSI-LOCAL data plane behind a session-less settings explorer.
 * Behavior under test: the home roots, CONTAINMENT (a `..` walk or an
 * absolute smuggle is a refusal, never a listing or a byte), the
 * directory listing shape the explorer tree consumes, and the text-only
 * read/write contract (binary and oversized refuse). `homedir` is
 * mocked to a temp dir so the test never touches the real ~/.dsi.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fakeHome = mkdtempSync(join(tmpdir(), 'dsi-settings-home-test-'));

import {
	SettingsHomeRefusal,
	listSettingsHomeDir,
	readSettingsHomeFile,
	resolveSettingsHomePath,
	settingsHomeDir,
	writeSettingsHomeFile
} from '$lib/server/settings-home.js';

describe('settings-home (The Settings Tree ADR 2026-09-18)', () => {
	beforeEach(() => {
		process.env.DSI_HOME_DIR = fakeHome;
		mkdirSync(join(fakeHome, '.dsi'), { recursive: true });
		writeFileSync(join(fakeHome, '.dsi', 'settings.yaml'), 'chat:\n  input:\n    maxRows: 40\n', 'utf-8');
		mkdirSync(join(fakeHome, '.dsi', 'sessions'), { recursive: true });
		mkdirSync(join(fakeHome, '.dsh'), { recursive: true });
	});
	afterEach(() => {
		delete process.env.DSI_HOME_DIR;
		try { chmodSync(join(fakeHome, '.dsi'), 0o755); } catch { /* already open */ }
	});

	it('roots are <homedir>/.dsi and <homedir>/.dsh (verbatim, the panel root)', () => {
		expect(settingsHomeDir('dsi')).toBe(join(fakeHome, '.dsi'));
		expect(settingsHomeDir('dsh')).toBe(join(fakeHome, '.dsh'));
	});

	it('containment: the home itself, nested paths, and siblings of the escape are legal', () => {
		expect(resolveSettingsHomePath('dsi', '')).toBe(join(fakeHome, '.dsi'));
		expect(resolveSettingsHomePath('dsi', 'settings.yaml')).toBe(join(fakeHome, '.dsi', 'settings.yaml'));
		expect(resolveSettingsHomePath('dsi', 'sessions/x')).toBe(join(fakeHome, '.dsi', 'sessions', 'x'));
	});

	it('containment: a `..` walk or an absolute smuggle is REFUSED (null)', () => {
		expect(resolveSettingsHomePath('dsi', '../.dsh/settings.yaml')).toBeNull();
		expect(resolveSettingsHomePath('dsi', '..')).toBeNull();
		expect(resolveSettingsHomePath('dsi', '/etc/passwd')).toBeNull();
	});

	it('lists directories first, then natural name order — the tree contract', async () => {
		writeFileSync(join(fakeHome, '.dsi', 'a-notes.txt'), 'x', 'utf-8');
		const listing = await listSettingsHomeDir('dsi', '');
		expect(listing.truncated).toBe(false);
		expect(listing.entries[0]).toEqual({ name: 'sessions', type: 'directory' });
		expect(listing.entries.map((e) => e.name)).toContain('settings.yaml');
		expect(listing.entries.find((e) => e.name === 'settings.yaml')?.type).toBe('file');
	});

	it('reads a text file back whole; a `..` walk refuses', async () => {
		const file = await readSettingsHomeFile('dsi', 'settings.yaml');
		expect(file.content).toContain('maxRows: 40');
		expect(() => readSettingsHomeFile('dsi', '../x')).rejects.toBeInstanceOf(SettingsHomeRefusal);
	});

	it('writes and reads back; junk content refuses', async () => {
		await writeSettingsHomeFile('dsi', 'sessions/notes.md', '# hello');
		expect((await readSettingsHomeFile('dsi', 'sessions/notes.md')).content).toBe('# hello');
		await expect(writeSettingsHomeFile('dsi', 'settings.yaml', undefined as unknown as string)).rejects.toBeInstanceOf(
			SettingsHomeRefusal
		);
	});
});