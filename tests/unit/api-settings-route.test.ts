/**
 * /api/settings route tests (Task 2.1-T) — the seam's contracts: GET per
 * target (present, missing + dsi defaultText, never a dsh default), PUT
 * happy path, parse-failure 400 carrying line/column with NO write,
 * invalid target 400, invalid body 400. Handlers invoked directly with
 * node-env Request objects (a2a-routes pattern).
 *
 * Spec: dev/specs/2026-09-07 - DSI Settings Panel (ADR D5/D7; Tasks
 *      2.1/2.1-T).
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET, PUT } from '../../src/routes/api/settings/+server';

let dir: string;
let dsiPath: string;
let dshPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'dsi-api-settings-'));
	dsiPath = join(dir, 'dsi-settings.yaml');
	dshPath = join(dir, 'dsh-settings.yaml');
	process.env.DSI_CONFIG_PATH = dsiPath;
	process.env.DSH_SETTINGS_PATH = dshPath;
});

afterEach(() => {
	delete process.env.DSI_CONFIG_PATH;
	delete process.env.DSH_SETTINGS_PATH;
});

const get = (target: string) => GET({ url: new URL(`http://local/api/settings?target=${target}`) } as never);

async function put(target: string, text: string) {
	const request = new Request(`http://local/api/settings?target=${target}`, {
		method: 'PUT',
		body: JSON.stringify({ text })
	});
	return PUT({ url: new URL(request.url), request } as never);
}

describe('GET /api/settings', () => {
	it('returns raw text for each target when present', async () => {
		writeFileSync(dsiPath, 'home:\n  refreshMs: 1234\n', 'utf-8');
		writeFileSync(dshPath, 'shell:\n  timeoutMs: 9000\n', 'utf-8');
		const a = (await (await get('dsi')).json()) as { text: string; missing: boolean };
		const b = (await (await get('dsh')).json()) as { text: string; missing: boolean };
		expect(a).toMatchObject({ text: 'home:\n  refreshMs: 1234\n', missing: false });
		expect(b).toMatchObject({ text: 'shell:\n  timeoutMs: 9000\n', missing: false });
	});

	it('missing dsi file returns the honest marker plus parseable default document', async () => {
		const r = (await (await get('dsi')).json()) as {
			missing: boolean;
			text: string;
			defaultText: string;
		};
		expect(r.missing).toBe(true);
		expect(r.text).toBe('');
		const doc = parse(r.defaultText) as Record<string, unknown>;
		expect(typeof doc.chat).toBe('object');
		expect(doc.dsh).toEqual({ presetEnglish: true });
		// The Settings Tree ADR 2026-09-18 D1: the workspace.layout knob is
		// DELETED — the default document lists no `workspace` section.
		expect(doc.workspace).toBeUndefined();
	});

	it('missing dsh file returns no fabricated defaults', async () => {
		const r = (await (await get('dsh')).json()) as { missing: boolean; defaultText: string };
		expect(r.missing).toBe(true);
		expect(r.defaultText).toBe('');
	});

	it('dsi GET migrates a legacy config.json first', async () => {
		writeFileSync(join(dir, 'config.json'), JSON.stringify({ home: { refreshMs: 4321 } }), 'utf-8');
		const r = (await (await get('dsi')).json()) as { text: string; missing: boolean };
		expect(r.missing).toBe(false);
		expect(r.text).toContain('refreshMs: 4321');
	});

	it('unknown target is a 400', async () => {
		const res = await get('nope');
		expect(res.status).toBe(400);
	});

	it('absent target is a 400', async () => {
		const res = await GET({ url: new URL('http://local/api/settings') } as never);
		expect(res.status).toBe(400);
	});
});

describe('PUT /api/settings', () => {
	it('saves valid YAML and the next GET reads it back', async () => {
		const res = await put('dsh', 'shell:\n  timeoutMs: 12000\n');
		expect(res.status).toBe(200);
		const r = (await (await get('dsh')).json()) as { text: string };
		expect(r.text).toBe('shell:\n  timeoutMs: 12000\n');
	});

	it('parse failure is a 400 with line and column and NO write', async () => {
		const res = await put('dsi', 'chat:\n  input: [unclosed\n');
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; line: number | null; column: number | null };
		expect(typeof body.error).toBe('string');
		expect(body.line).not.toBeNull();
		expect(existsSync(dsiPath)).toBe(false);
	});

	it('unknown target is a 400 before any write', async () => {
		const res = await put('nope', 'a: 1\n');
		expect(res.status).toBe(400);
	});

	it('non-string text is a 400', async () => {
		const request = new Request('http://local/api/settings?target=dsi', {
			method: 'PUT',
			body: JSON.stringify({ text: 42 })
		});
		const res = await PUT({ url: new URL(request.url), request } as never);
		expect(res.status).toBe(400);
	});

	it('non-JSON body is a 400', async () => {
		const request = new Request('http://local/api/settings?target=dsi', {
			method: 'PUT',
			body: 'not json'
		});
		const res = await PUT({ url: new URL(request.url), request } as never);
		expect(res.status).toBe(400);
	});

	it('a saved edit round-trips through the section readers', async () => {
		await put('dsi', 'server:\n  ringCapacity: 750\n');
		const text = readFileSync(dsiPath, 'utf-8');
		expect(text).toContain('ringCapacity: 750');
	});
});
