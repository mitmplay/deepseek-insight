/**
 * Unit: settings-home EXTRA branches — the arms the first suite misses:
 * the DSI_HOME_DIR whitespace arm, isSettingsHome's literal gate, the
 * non-string rel smuggle, stat-failure 'other' rows (broken symlink),
 * the not-file / too-large / binary read refusals, and the too-large
 * write refusal. homedir is mocked to a temp dir — never the real ~/.dsi.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fakeHome = mkdtempSync(join(tmpdir(), 'dsi-settings-home-extra-'));

import {
	SETTINGS_HOME_MAX_BYTES,
	SettingsHomeRefusal,
	isSettingsHome,
	listSettingsHomeDir,
	readSettingsHomeFile,
	resolveSettingsHomePath,
	settingsHomeDir,
	writeSettingsHomeFile
} from '$lib/server/settings-home.js';

describe('settings-home extra branches (containment + refusal arms)', () => {
	beforeEach(() => {
		process.env.DSI_HOME_DIR = fakeHome;
		mkdirSync(join(fakeHome, '.dsi'), { recursive: true });
		mkdirSync(join(fakeHome, '.dsh'), { recursive: true });
		writeFileSync(join(fakeHome, '.dsi', 'settings.yaml'), 'a: 1\n', 'utf-8');
	});
	afterEach(() => {
		delete process.env.DSI_HOME_DIR;
	});

	it('DSI_HOME_DIR whitespace-only falls back to homedir (the trim arm)', () => {
		process.env.DSI_HOME_DIR = '   ';
		expect(settingsHomeDir('dsi')).not.toBe(join(fakeHome, '.dsi'));
	});

	it('isSettingsHome accepts only the literal homes', () => {
		expect(isSettingsHome('dsi')).toBe(true);
		expect(isSettingsHome('dsh')).toBe(true);
		expect(isSettingsHome('etc')).toBe(false);
		expect(isSettingsHome(undefined)).toBe(false);
		expect(isSettingsHome(null)).toBe(false);
	});

	it('resolveSettingsHomePath: non-string rel refuses; "." resolves to the home itself', () => {
		expect(resolveSettingsHomePath('dsi', 42 as unknown as string)).toBeNull();
		expect(resolveSettingsHomePath('dsi', '.')).toBe(join(fakeHome, '.dsi'));
	});

	it("listSettingsHomeDir: an entry that is neither file nor directory rows 'other' (a fifo)", async () => {
		// mkfifoSync is not in this Node's fs — shell out for the fifo fixture
		execFileSync('/usr/bin/mkfifo', [join(fakeHome, '.dsi', 'pipe')]);
		const listing = await listSettingsHomeDir('dsi', '');
		expect(listing.entries.find((e) => e.name === 'pipe')?.type).toBe('other');
		rmSync(join(fakeHome, '.dsi', 'pipe'));
	});

	it('listSettingsHomeDir: an escaping path refuses (bad-path)', async () => {
		await expect(listSettingsHomeDir('dsi', '../outside')).rejects.toMatchObject({ code: 'bad-path' });
	});

	it('listSettingsHomeDir: a stat failure is an honest other row (broken symlink)', async () => {
		symlinkSync(join(fakeHome, 'no-such-target'), join(fakeHome, '.dsi', 'dangling'));
		try {
			const listing = await listSettingsHomeDir('dsi', '');
			const row = listing.entries.find((e) => e.name === 'dangling');
			expect(row?.type).toBe('other');
			expect(row?.name).toBe('dangling');
		} finally {
			rmSync(join(fakeHome, '.dsi', 'dangling'));
		}
	});

	it('readSettingsHomeFile: escape / missing / directory / oversized / binary all refuse', async () => {
		await expect(readSettingsHomeFile('dsi', '../x')).rejects.toMatchObject({ code: 'bad-path' });
		await expect(readSettingsHomeFile('dsi', 'missing.yaml')).rejects.toMatchObject({ code: 'not-file' });
		await expect(readSettingsHomeFile('dsi', '.')).rejects.toMatchObject({ code: 'not-file' });
		writeFileSync(join(fakeHome, '.dsi', 'big.yaml'), 'x'.repeat(SETTINGS_HOME_MAX_BYTES + 1), 'utf-8');
		await expect(readSettingsHomeFile('dsi', 'big.yaml')).rejects.toMatchObject({ code: 'too-large' });
		writeFileSync(join(fakeHome, '.dsi', 'bin.yaml'), Buffer.from([0x61, 0x00, 0x62]));
		await expect(readSettingsHomeFile('dsi', 'bin.yaml')).rejects.toMatchObject({ code: 'binary' });
	});

	it('writeSettingsHomeFile: escape refuses; oversized content refuses; round-trips within the cap', async () => {
		await expect(writeSettingsHomeFile('dsi', '../x', 'a')).rejects.toMatchObject({ code: 'bad-path' });
		await expect(
			writeSettingsHomeFile('dsi', 'big-out.yaml', 'x'.repeat(SETTINGS_HOME_MAX_BYTES + 1))
		).rejects.toMatchObject({ code: 'too-large' });
		await writeSettingsHomeFile('dsi', 'deep/dir/ok.yaml', 'ok');
		expect((await readSettingsHomeFile('dsi', 'deep/dir/ok.yaml')).content).toBe('ok');
	});

	it('SettingsHomeRefusal carries its code and message', () => {
		const err = new SettingsHomeRefusal('bad-path', 'nope');
		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe('bad-path');
		expect(err.message).toBe('nope');
	});
});
