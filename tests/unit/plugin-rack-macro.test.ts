/**
 * Task 2.2-T - /dsi-plugins macro: parser grammar (bare, --reload, leftover
 * args) and the executor contract (reload posts /api/plugins/reload before
 * addPanel; bare never does; off-floor usage-errors; the /dsi-skills shelf
 * shapes stay byte-identical - shared-file lockstep).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { parseCommand } from '../../src/lib/services/chat/command-parser';
import { executeCommand, setAddPanelFromSidebarForTest } from '../../src/lib/services/chat/command-executor';

const added: unknown[] = [];

beforeEach(() => {
	added.length = 0;
	setAddPanelFromSidebarForTest((request) => {
		added.push(request);
	});
	vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }))));
});
afterEach(() => {
	setAddPanelFromSidebarForTest(null);
	vi.unstubAllGlobals();
});

const CTX = { panelId: 'p1', sessionId: 's1' } as never;

describe('/dsi-plugins parser', () => {
	it('bare command parses with no reload flag', () => {
		const cmd = parseCommand('/dsi-plugins');
		expect(cmd).toMatchObject({ type: 'pluginrack' });
		expect(cmd?.reload).toBeUndefined();
	});
	it('--reload variant captures the flag', () => {
		expect(parseCommand('/dsi-plugins --reload')).toMatchObject({ type: 'pluginrack', reload: true, args: '' });
	});
	it('leftover args keep the raw shape (executor usage-errors them)', () => {
		const cmd = parseCommand('/dsi-plugins wat');
		expect(cmd?.type).toBe('pluginrack');
		expect(cmd?.args).toBe('wat');
	});
});

describe('/dsi-plugins executor', () => {
	it('bare: adds the rack panel, never calls reload', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const out = await executeCommand({ type: 'pluginrack', args: '' }, CTX);
		expect(out.ok).toBe(true);
		expect(added).toEqual([{ kind: 'plugin-rack', afterSessionId: 's1' }]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it('--reload: rebuilds first, then adds the panel', async () => {
		const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })));
		vi.stubGlobal('fetch', fetchMock);
		const out = await executeCommand({ type: 'pluginrack', args: '', reload: true }, CTX);
		expect(out.ok).toBe(true);
		const calls = fetchMock.mock.calls as unknown as [string][];
		expect(calls[0][0]).toBe('/api/plugins/reload');
		expect(added).toHaveLength(1);
	});
	it('--reload failure: honest note, no panel', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 503 }))));
		const notes: [boolean, string][] = [];
		const out = await executeCommand({ type: 'pluginrack', args: '', reload: true }, CTX, (ok, msg) => notes.push([ok, msg]) as never);
		expect(out.ok).toBe(false);
		expect(notes.some(([, m]) => m.includes('snapshot rebuild failed (503)'))).toBe(true);
		expect(added).toHaveLength(0);
	});
	it('leftover args: honest usage note, no panel', async () => {
		const notes: [boolean, string][] = [];
		const out = await executeCommand({ type: 'pluginrack', args: 'wat' }, CTX, (ok, msg) => notes.push([ok, msg]) as never);
		expect(out.ok).toBe(false);
		expect(notes.some(([, m]) => m === 'usage: /dsi-plugins [--reload]')).toBe(true);
		expect(added).toHaveLength(0);
	});
});

describe('/dsi-skills lockstep (shared-file regression)', () => {
	it('the shelf grammar is untouched by the rack wiring', async () => {
		expect(parseCommand('/dsi-skills')).toMatchObject({ type: 'skillshelf' });
		expect(parseCommand('/dsi-skills --reload')).toMatchObject({ type: 'skillshelf', reload: true });
		const out = await executeCommand({ type: 'skillshelf', args: '' }, CTX);
		expect(out.ok).toBe(true);
		expect(added).toEqual([{ kind: 'skill-shelf', afterSessionId: 's1' }]);
	});
});
