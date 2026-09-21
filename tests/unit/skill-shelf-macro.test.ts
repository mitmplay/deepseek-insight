/**
 * 3.3-T - /dsi-skill-shelf macro: parser grammar (bare, --reload, leftover
 * args) and the executor contract (reload flag posts to /api/skills/reload
 * before addPanel; bare never does; off-floor composer usage-errors).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { parseCommand } from '../../src/lib/services/chat/command-parser';
import { executeCommand, setAddPanelFromSidebarForTest } from '../../src/lib/services/chat/command-executor';
import { commandHelpTopic } from '../../src/lib/services/chat/command-help';

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

describe('/dsi-skill-shelf parser', () => {
	it('bare command parses with no reload flag', () => {
		const cmd = parseCommand('/dsi-skill-shelf');
		expect(cmd).toMatchObject({ type: 'skillshelf' });
		expect(cmd?.reload).toBeUndefined();
	});
	it('--reload variant captures the flag', () => {
		const cmd = parseCommand('/dsi-skill-shelf --reload');
		expect(cmd).toMatchObject({ type: 'skillshelf', reload: true, args: '' });
	});
	it('leftover args keep the raw shape (executor usage-errors them)', () => {
		const cmd = parseCommand('/dsi-skill-shelf wat');
		expect(cmd?.type).toBe('skillshelf');
		expect(cmd?.args).toBe('wat');
		expect(cmd?.reload).toBeUndefined();
	});
});

describe('/dsi-skill-shelf executor', () => {
	it('bare: adds the shelf panel, never calls reload', async () => {
		const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })));
		const out = await executeCommand({ type: 'skillshelf', args: '' }, CTX);
		expect(out.ok).toBe(true);
		expect(added).toEqual([{ kind: 'skill-shelf', afterSessionId: 's1' }]);
	});
	it('--reload: rebuilds first, then adds the panel', async () => {
		const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })));
		vi.stubGlobal('fetch', fetchMock);
		const out = await executeCommand({ type: 'skillshelf', args: '', reload: true }, CTX);
		expect(out.ok).toBe(true);
		const calls = fetchMock.mock.calls as unknown as [string, RequestInit?][];
		const reloadIdx = calls.findIndex(([u]) => u === '/api/skills/reload');
		expect(reloadIdx).toBeGreaterThanOrEqual(0);
		expect(calls[reloadIdx][1]?.method).toBe('POST');
		expect(added).toEqual([{ kind: 'skill-shelf', afterSessionId: 's1' }]);
	});
	it('off-floor composer usage-errors honestly', async () => {
		const notes: [boolean, string][] = [];
		const out = await executeCommand({ type: 'skillshelf', args: '' }, { panelId: null, sessionId: 's1' } as never, (ok, msg) => {
			notes.push([ok, msg]);
		});
		expect(out.ok).toBe(false);
		expect(notes[0][1]).toContain('needs a panel floor');
		expect(added).toEqual([]);
	});
});

describe('/dsi-skill-shelf discovery surfaces (The Shelf Voice W1)', () => {
	it('the ? help intent resolves the skillshelf topic', () => {
		expect(commandHelpTopic('/dsi-skill-shelf ?')).toBe('skillshelf');
		expect(commandHelpTopic('/dsi-skill-shelf')).toBeNull(); // bare command is not a help request
	});

	it('leftover args produce the honest usage note', async () => {
		const notes: [boolean, string][] = [];
		setAddPanelFromSidebarForTest(() => {});
		const out = await executeCommand({ type: 'skillshelf', args: 'wat' }, { panelId: 'p1', sessionId: 's1' } as never, (ok, msg) => {
			notes.push([ok, msg]);
		});
		expect(out.ok).toBe(false);
		expect(notes[0][1]).toBe('usage: /dsi-skill-shelf [--reload]');
		setAddPanelFromSidebarForTest(null);
	});
});
