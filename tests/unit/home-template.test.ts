import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	ensureDsiHome,
	readSettingsDocument,
	templateHomePath
} from '$lib/server/settings-document.js';

let root: string;
let template: string;
let home: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dsi-home-template-'));
	template = join(root, 'template');
	home = join(root, 'home');
	mkdirSync(template, { recursive: true });
	writeFileSync(join(template, 'settings.yaml'), 'home:\n  refreshMs: 1234\n', 'utf-8');
	writeFileSync(join(template, 'prompts.sqlite'), 'seed-bytes', 'utf-8');
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	delete process.env.DSI_TEMPLATE_PATH;
});

describe('ensureDsiHome', () => {
	it('clones the template into a missing home', () => {
		expect(ensureDsiHome(home, template)).toBe('cloned');
		expect(readSettingsDocument('dsi', join(home, 'settings.yaml')).text).toContain('refreshMs: 1234');
		expect(existsSync(join(home, 'prompts.sqlite'))).toBe(true);
	});

	it('never touches an existing home', () => {
		mkdirSync(home, { recursive: true });
		writeFileSync(join(home, 'settings.yaml'), 'home:\n  refreshMs: 9\n', 'utf-8');
		expect(ensureDsiHome(home, template)).toBe('exists');
		expect(readSettingsDocument('dsi', join(home, 'settings.yaml')).text).toContain('refreshMs: 9');
	});

	it('no-ops without a template', () => {
		expect(ensureDsiHome(home, join(root, 'absent'))).toBe('no-template');
		expect(existsSync(home)).toBe(false);
	});

	it('resolves the template via DSI_TEMPLATE_PATH', () => {
		process.env.DSI_TEMPLATE_PATH = template;
		expect(templateHomePath()).toBe(template);
		expect(ensureDsiHome(home)).toBe('cloned');
	});

	it('clones on a plain settings read when the home is missing', () => {
		const settingsPath = join(home, 'settings.yaml');
		process.env.DSI_TEMPLATE_PATH = template;
		expect(ensureDsiHome(home, join(root, 'absent'))).toBe('no-template');
		const doc = readSettingsDocument('dsi', settingsPath);
		expect(doc.missing).toBe(false);
		expect(doc.text).toContain('refreshMs: 1234');
	});
});
