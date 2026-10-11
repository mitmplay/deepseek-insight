/**
 * executor/panels edge tests — direct calls to the six panel-opener verbs
 * so every guard arm (leftover args, no panel floor, reload wire failures,
 * floor-not-mounted, loadinjected resolution ladder) is covered without
 * the composer shell. addPanel/replacePanel go through the registry seams.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	runTerminal,
	runPromptManager,
	runPluginRack,
	runSkillShelf,
	runSettingsEditor,
	runLoadInjected
} from '$lib/services/chat/executor/panels';
import { setAddPanelFromSidebarForTest } from '$lib/services/chat/executor/panels';
import { registerAddPanel, registerReplacePanel } from '$lib/services/panels/panel-registry';
import type { ExecutorContext } from '$lib/services/chat/command-executor';

const SELF = 'session-11111111-0000-4000-8000-000000000001';
function ctx(over: Partial<ExecutorContext> = {}): ExecutorContext {
	return { sessionId: SELF, workspace: '/w/proj', agent: null, panelId: 'p1', ...over };
}
function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Capture add/replace requests as accepted; false = no floor mounted
 *  (the registry's "not mounted" is a NULL handler, so refusal unregisters). */
function acceptAdds(accept = true) {
	const added: Array<{ panelId?: string; request?: unknown; req?: unknown }> = [];
	if (accept) {
		registerAddPanel((req) => {
			added.push({ req });
		});
		registerReplacePanel((panelId, req) => {
			added.push({ panelId, request: req });
		});
	} else {
		registerAddPanel(null);
		registerReplacePanel(null);
	}
	return added;
}

afterEach(() => {
	registerAddPanel(null);
	registerReplacePanel(null);
	setAddPanelFromSidebarForTest(null);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('runTerminal', () => {
	it('leftover args and a missing panel floor refuse before any probe', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const r1 = await runTerminal('extra', undefined, ctx());
		expect(r1.note).toBe('usage: /dsi-terminal [--new-tab | --split-down]');
		const r2 = await runTerminal('', undefined, ctx({ panelId: null }));
		expect(r2.note).toBe('/dsi-terminal needs a panel floor (open this session on the floor first)');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('a disabled probe notes the settings fact; a failing probe still opens', async () => {
		const added = acceptAdds();
		vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ enabled: false })));
		const r1 = await runTerminal('', 'new-tab', ctx());
		expect(r1.ok).toBe(false);
		expect(r1.note).toBe('/dsi-terminal is disabled — set terminal.enabled in settings');
		expect(added.length).toBe(0);
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('probe down'); }));
		const r2 = await runTerminal('', 'split-down', ctx());
		expect(r2).toEqual({ ok: true });
		expect(added[0].req).toMatchObject({ kind: 'terminal', action: 'split-down', afterSessionId: SELF });
	});

	it('the floor refusing the add is an honest note', async () => {
		acceptAdds(false);
		vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ enabled: true })));
		const r = await runTerminal('', undefined, ctx());
		expect(r).toEqual({ ok: false, note: '/dsi-terminal: the floor is not mounted' });
	});
});

describe('runPromptManager', () => {
	it('guards, then the happy aim; the floor refusal is a note', async () => {
		const added = acceptAdds();
		const r1 = await runPromptManager('extra', ctx());
		expect(r1.note).toBe('usage: /dsi-prompts');
		const r2 = await runPromptManager('', ctx({ panelId: null }));
		expect(r2.note).toBe('/dsi-prompts needs a panel floor (open this session on the floor first)');
		const r3 = await runPromptManager('', ctx());
		expect(r3).toEqual({ ok: true });
		expect(added[0].req).toEqual({ kind: 'prompt-manager', afterSessionId: SELF });
		acceptAdds(false);
		const r4 = await runPromptManager('', ctx());
		expect(r4).toEqual({ ok: false, note: '/dsi-prompts: the floor is not mounted' });
	});
});

describe('runPluginRack', () => {
	it('usage + floor guards', async () => {
		const r1 = await runPluginRack('extra', false, ctx());
		expect(r1.note).toBe('usage: /dsi-plugins [--reload]');
		const r2 = await runPluginRack('', false, ctx({ panelId: null }));
		expect(r2.note).toBe('/dsi-plugins needs a panel floor (open this session on the floor first)');
	});

	it('reload rides the wire: ok, non-ok status, and a network failure', async () => {
		const added = acceptAdds();
		vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: true })));
		const ok = await runPluginRack('', true, ctx());
		expect(ok).toEqual({ ok: true });
		expect(added[0].req).toMatchObject({ kind: 'plugin-rack', reload: true });

		vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: false }, 500)));
		const bad = await runPluginRack('', true, ctx());
		expect(bad.note).toBe('/dsi-plugins: snapshot rebuild failed (500)');

		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
		const net = await runPluginRack('', true, ctx());
		expect(net.note).toBe('/dsi-plugins: snapshot rebuild failed (network)');
	});

	it('without --reload no wire call happens and the flag stays off the request', async () => {
		const added = acceptAdds();
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const r = await runPluginRack('', false, ctx());
		expect(r).toEqual({ ok: true });
		expect(added[0]).not.toHaveProperty('reload');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('the floor refusing is an honest note', async () => {
		acceptAdds(false);
		vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: true })));
		const r = await runPluginRack('', true, ctx());
		expect(r).toEqual({ ok: false, note: '/dsi-plugins: the floor is not mounted' });
	});
});

describe('runSkillShelf', () => {
	it('usage + floor guards', async () => {
		const r1 = await runSkillShelf('extra', false, ctx());
		expect(r1.note).toBe('usage: /dsi-skills [--reload]');
		const r2 = await runSkillShelf('', false, ctx({ panelId: null }));
		expect(r2.note).toBe('/dsi-skills needs a panel floor (open this session on the floor first)');
	});

	it('reload: ok, non-ok, network — and the flag rides the add on success', async () => {
		const added = acceptAdds();
		vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: true })));
		const ok = await runSkillShelf('', true, ctx());
		expect(ok).toEqual({ ok: true });
		expect(added[0].req).toMatchObject({ kind: 'skill-shelf', reload: true });

		vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: false }, 503)));
		expect((await runSkillShelf('', true, ctx())).note).toBe('/dsi-skills: snapshot rebuild failed (503)');

		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
		expect((await runSkillShelf('', true, ctx())).note).toBe('/dsi-skills: snapshot rebuild failed (network)');
	});

	it('the floor refusing is an honest note', async () => {
		acceptAdds(false);
		vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: true })));
		expect((await runSkillShelf('', true, ctx())).note).toBe('/dsi-skills: the floor is not mounted');
	});
});

describe('runSettingsEditor', () => {
	it('usage + floor guards carry the command name', async () => {
		const r1 = await runSettingsEditor('dsi', '/dsi-settings', 'extra', ctx());
		expect(r1.note).toBe('usage: /dsi-settings');
		const r2 = await runSettingsEditor('dsh', '/dsh-settings', '', ctx({ panelId: null }));
		expect(r2.note).toBe('/dsh-settings needs a panel floor (open this session on the floor first)');
	});

	it('the happy aim carries the home; the floor refusal is a note', async () => {
		const added = acceptAdds();
		const r1 = await runSettingsEditor('dsh', '/dsh-settings', '', ctx());
		expect(r1).toEqual({ ok: true });
		expect(added[0].req).toMatchObject({ kind: 'settings-home', home: 'dsh' });
		acceptAdds(false);
		const r2 = await runSettingsEditor('dsi', '/dsi-settings', '', ctx());
		expect(r2).toEqual({ ok: false, note: '/dsi-settings: the floor is not mounted' });
	});
});

describe('runLoadInjected', () => {
	const ENTRIES = [
		{
			kind: 'user-message',
			meta: 'instructions',
			metaSource: { baseline: true, changes: [{ path: '/w/proj/AGENTS.md' }] }
		}
	] as never as ExecutorContext['entries'];

	it('the typed shape (no filename) gets the retirement pointer', async () => {
		const r = await runLoadInjected(undefined, false, ctx());
		expect(r.ok).toBe(false);
		expect(r.note).toContain('/loadinjected retired');
	});

	it('a missing floor refuses before resolution', async () => {
		const r = await runLoadInjected('AGENTS.md', false, ctx({ panelId: null }));
		expect(r.note).toBe('/loadinjected needs a panel floor (open this session on the floor first)');
	});

	it('a workspace-pasted path is normalized (D4); misses carry the candidates', async () => {
		const added = acceptAdds();
		// pasted absolute → stripped to the shelf token → resolves
		const ok = await runLoadInjected('/w/proj/AGENTS.md', false, ctx({ entries: ENTRIES }));
		expect(ok).toEqual({ ok: true });
		expect(added[0].request).toMatchObject({
			kind: 'injected-doc',
			displayPath: '/w/proj/AGENTS.md',
			sourceSessionId: SELF
		});
		// ambiguous basename → the honest candidates note
		const miss = await runLoadInjected('missing.md', false, ctx({ entries: ENTRIES }));
		expect(miss.note).toContain('no injected missing.md here — the shelf holds: /w/proj/AGENTS.md');
		// empty shelf → the nothing-injected-yet note
		const none = await runLoadInjected('missing.md', false, ctx());
		expect(none.note).toBe('/loadinjected: nothing was injected into this conversation yet');
	});

	it('--add opens a panel BELOW the source; a refused add and a refused swap are notes', async () => {
		acceptAdds(false);
		const refused = await runLoadInjected('AGENTS.md', true, ctx({ entries: ENTRIES }));
		expect(refused.note).toBe('/loadinjected: the floor is not mounted');
		const added = acceptAdds();
		const okAdd = await runLoadInjected('AGENTS.md', true, ctx({ entries: ENTRIES }));
		expect(okAdd).toEqual({ ok: true });
		expect(added[0].req).toMatchObject({ afterSessionId: SELF });
	});
});