/**
 * panel-kind.test.ts — W2 task 2.1-T: the DsiPanelEntry kind union and
 * the kind-tagged PanelAddRequest (ADR "The Manager in the Panel" D6).
 *
 * Contracts pinned:
 * 1. REGISTRY — a manager request reaches the registered add handler
 *    verbatim (the union flows); a legacy literal without kind still
 *    compiles and flows (the conversation path is unchanged).
 * 2. TYPE-LEVEL UNREACHABILITY — the manager branch has no sessionId
 *    (expectTypeOf pins the narrowed member); session-keyed maps cannot
 *    read it without narrowing.
 * 3. PERSISTENCE — the dsi-panels blob round-trips a kind-tagged floor:
 *    legacy entries sanitize to 'conversation', manager entries keep
 *    their kind and never gain session fields, unknown kinds drop.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { expectTypeOf } from 'vitest';
import {
	addPanelFromSidebar,
	registerAddPanel,
	resetPanelRegistryForTests,
	type PanelAddRequest
} from '$lib/services/panels/panel-registry';
import {
	isPanelEntry,
	loadPanelPrefs,
	panelPrefsKey,
	savePanelPrefs,
	type PanelPrefs
} from '$lib/utils/panel-prefs';
import type {
	DsiConversationPanel,
	DsiInjectedDocPanel,
	DsiPanelEntry,
	DsiPromptManagerPanel,
	DsiSettingsPanel,
	DsiWorkspaceExplorerPanel,
	DsiWorkspaceFilePanel
} from '$lib/types';

afterEach(() => {
	resetPanelRegistryForTests();
	localStorage.clear();
});

describe('PanelAddRequest kind union (2.1-T)', () => {
	it('a manager request reaches the registered add handler verbatim', () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((request) => seen.push(request));
		const fired = addPanelFromSidebar({ kind: 'prompt-manager', afterSessionId: 's-anchor' });
		expect(fired).toBe(true);
		expect(seen).toEqual([{ kind: 'prompt-manager', afterSessionId: 's-anchor' }]);
	});

	it('a legacy literal without kind flows unchanged (conversation path)', () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((request) => seen.push(request));
		addPanelFromSidebar({ sessionId: 's1', agentPreset: null });
		expect(seen).toEqual([{ sessionId: 's1', agentPreset: null }]);
	});

	it('TYPE-LEVEL: the manager request has no session fields; the conversation entry keeps them', () => {
		expectTypeOf<DsiPromptManagerPanel>().not.toHaveProperty('sessionId');
		expectTypeOf<DsiConversationPanel['sessionId']>().toEqualTypeOf<string>();
		// The request union narrows on kind — the session path is
		// unreachable for the manager branch at compile time.
		expectTypeOf<Extract<PanelAddRequest, { kind: 'prompt-manager' }>>().not.toHaveProperty(
			'sessionId'
		);
	});
});

describe('DsiPanelEntry kind union — persistence round-trip (2.1-T)', () => {
	it('isPanelEntry: legacy shape, manager shape, and junk kinds', () => {
		expect(isPanelEntry({ id: 'p1', sessionId: 's1', agentPreset: null, width: 10 })).toBe(true);
		expect(isPanelEntry({ id: 'm1', kind: 'prompt-manager', width: 10 })).toBe(true);
		expect(isPanelEntry({ id: 'x', kind: 'telemetry', width: 10 })).toBe(false);
		// A manager entry needs no session; a conversation entry still does.
		expect(isPanelEntry({ id: 'm1', kind: 'prompt-manager' })).toBe(true);
		expect(isPanelEntry({ id: 'c1', kind: 'conversation' })).toBe(false);
		// The Skill Shelf ADR: the shelf persists like the manager — no
		// session fields, kind whitelisted (hard-reload survival fix).
		expect(isPanelEntry({ id: 'sh1', kind: 'skill-shelf', width: 480 })).toBe(true);
	});

	it('a kind-tagged blob restores kind-honest panels; session fields never cross kinds', () => {
		const prefs: PanelPrefs = {
			panels: [
				{ id: 'panel-1', kind: 'conversation', sessionId: 's1', agentPreset: null, width: 730 },
				{ id: 'panel-2', kind: 'prompt-manager', width: 700 }
			],
			selectedPanelId: 'panel-2',
			panelWidth: 730,
			zoom: 1
		};
		savePanelPrefs(prefs);
		const loaded = loadPanelPrefs();
		expect(loaded.panels).toHaveLength(2);
		expect(loaded.selectedPanelId).toBe('panel-2');
		const [conv, mgr] = loaded.panels as [DsiConversationPanel, DsiPromptManagerPanel];
		expect(conv.kind).toBe('conversation');
		expect(conv.sessionId).toBe('s1');
		expect(mgr.kind).toBe('prompt-manager');
		// The manager branch never gains session fields from the blob.
		expect(Object.keys(mgr).sort()).toEqual(['id', 'kind', 'width']);
	});

	it('a legacy blob (no kind anywhere) restores as conversation panels', () => {
		localStorage.setItem(
			panelPrefsKey(),
			JSON.stringify({
				panels: [{ id: 'panel-1', sessionId: 's-old', agentPreset: 'main', width: 500 }],
				selectedPanelId: 'panel-1',
				panelWidth: 730,
				zoom: 1
			})
		);
		const loaded = loadPanelPrefs();
		expect(loaded.panels[0]!.kind).toBe('conversation');
		expect((loaded.panels[0] as DsiConversationPanel).sessionId).toBe('s-old');
	});
});

// ── Settings Panel W3 3.1-T — the settings-editor branch (2026-09-07 ADR D3) ──

describe('settings-editor branch (Settings Panel ADR D3)', () => {
	afterEach(() => resetPanelRegistryForTests());

	it('REGISTRY — a settings-home request reaches the add handler verbatim, home intact', () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((r) => seen.push(r));
		expect(
			addPanelFromSidebar({ kind: 'settings-home', home: 'dsh', afterSessionId: 'session-1' })
		).toBe(true);
		expect(seen).toEqual([{ kind: 'settings-home', home: 'dsh', afterSessionId: 'session-1' }]);
	});

	it('TYPE-LEVEL — the branch carries home and never sessionId; the retired settings-editor request kind is gone', () => {
		// Settings Tree ADR D2: /dsi-settings & /dsh-settings mint a settings-home
		// request — the retired single-file settings-editor kind is no longer
		// in the request union.
		expectTypeOf<PanelAddRequest['kind']>().not.toHaveProperty('settings-editor');
		expectTypeOf<Extract<PanelAddRequest, { kind: 'settings-home' }>>().toHaveProperty('home');
		expectTypeOf<
			Extract<PanelAddRequest, { kind: 'settings-home' }>
		>().not.toHaveProperty('sessionId');
		// The settings-editor PANEL ENTRY survives as a legacy blob shape only.
		expectTypeOf<DsiSettingsPanel>().toEqualTypeOf<{
			id: string;
			kind: 'settings-editor';
			target: 'dsi' | 'dsh';
			width: number;
		}>();
	});

	it('PERSISTENCE — a settings-editor entry round-trips kind and target; junk targets drop', () => {
		const good: DsiPanelEntry = { id: 'panel-1', kind: 'settings-editor', target: 'dsi', width: 600 };
		expect(isPanelEntry(good)).toBe(true);
		savePanelPrefs({
			panels: [good],
			selectedPanelId: 'panel-1',
			panelWidth: 730,
			zoom: 1
		} as PanelPrefs);
		const loaded = loadPanelPrefs();
		expect(loaded.panels).toEqual([good]);
		expect(
			isPanelEntry({ id: 'panel-2', kind: 'settings-editor', target: 'nope', width: 600 })
		).toBe(false);
	});
});

// ── Loadinjected W1 1.1-T — the injected-doc branch (2026-09-07 ADR D2/D5) ──

describe('injected-doc branch (Loadinjected ADR D2)', () => {
	afterEach(() => resetPanelRegistryForTests());

	it('REGISTRY — an injected-doc request reaches the add handler verbatim', () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((r) => seen.push(r));
		expect(
			addPanelFromSidebar({
				kind: 'injected-doc',
				sourceSessionId: 'session-1',
				displayPath: 'AGENTS.md',
				afterSessionId: 'session-1'
			})
		).toBe(true);
		expect(seen).toEqual([
			{
				kind: 'injected-doc',
				sourceSessionId: 'session-1',
				displayPath: 'AGENTS.md',
				afterSessionId: 'session-1'
			}
		]);
	});

	it('TYPE-LEVEL — the branch carries the dedupe pair and never session fields', () => {
		expectTypeOf<Extract<PanelAddRequest, { kind: 'injected-doc' }>>().toHaveProperty(
			'sourceSessionId'
		);
		expectTypeOf<Extract<PanelAddRequest, { kind: 'injected-doc' }>>().toHaveProperty(
			'displayPath'
		);
		expectTypeOf<
			Extract<PanelAddRequest, { kind: 'injected-doc' }>
		>().not.toHaveProperty('sessionId');
		expectTypeOf<
			Extract<PanelAddRequest, { kind: 'injected-doc' }>
		>().not.toHaveProperty('agentPreset');
		expectTypeOf<DsiInjectedDocPanel>().toEqualTypeOf<{
			id: string;
			kind: 'injected-doc';
			sourceSessionId: string;
			displayPath: string;
			width: number;
		}>();
	});

	it('PERSISTENCE — an injected-doc entry round-trips the dedupe pair; junk pairs drop', () => {
		const good: DsiPanelEntry = {
			id: 'panel-1',
			kind: 'injected-doc',
			sourceSessionId: 'session-1',
			displayPath: 'AGENTS.md',
			width: 600
		};
		expect(isPanelEntry(good)).toBe(true);
		savePanelPrefs({
			panels: [good],
			selectedPanelId: 'panel-1',
			panelWidth: 730,
			zoom: 1
		} as PanelPrefs);
		const loaded = loadPanelPrefs();
		expect(loaded.panels).toEqual([good]);
		// Half a dedupe key is hard junk — the entry drops.
		expect(
			isPanelEntry({ id: 'p2', kind: 'injected-doc', sourceSessionId: 's1', width: 600 })
		).toBe(false);
		expect(isPanelEntry({ id: 'p3', kind: 'injected-doc', displayPath: '', width: 600 })).toBe(
			false
		);
	});
});

// ── Workspace Explorer W1 1.1-T — the two workspace branches (2026-09-10 ADR D2) ──

describe('workspace branches (Workspace Explorer ADR D2)', () => {
	afterEach(() => resetPanelRegistryForTests());

	it('TYPE-LEVEL — the explorer carries sessionId + root + expanded; the file pair is the dedupe key', () => {
		expectTypeOf<DsiWorkspaceExplorerPanel>().toEqualTypeOf<{
			id: string;
			kind: 'workspace-explorer';
			// Settings Tree ADR D3: null for a session-less (settings-home)
			// explorer; provenance only — root is the dedupe key.
			sessionId: string | null;
			root: string;
			title?: string;
			home?: 'dsi' | 'dsh';
			expanded: string[];
			tab?: 'explorer' | 'changes';
			collapsedRepos?: string[];
			openTabs?: string[];
			activeFile?: string | null;
			width: number;
		}>();
		expectTypeOf<DsiWorkspaceFilePanel>().toEqualTypeOf<{
			id: string;
			kind: 'workspace-file';
			sessionId: string;
			path: string;
			explorerPanelId: string | null;
			view?: 'edit' | 'diff';
			width: number;
		}>();
		// Neither live branch degrades to injected-doc: no displayPath, no
		// logged-payload semantics (ADR D2 rejection).
		expectTypeOf<DsiWorkspaceExplorerPanel>().not.toHaveProperty('displayPath');
		expectTypeOf<DsiWorkspaceFilePanel>().not.toHaveProperty('displayPath');
	});

	it('PERSISTENCE — both workspace kinds round-trip through the blob', () => {
		const explorer: DsiPanelEntry = {
			id: 'panel-1',
			kind: 'workspace-explorer',
			sessionId: 'session-1',
			root: '/tmp/ws',
			expanded: ['docs', 'src/lib'],
			tab: 'explorer',
			// Git Eye (2026-09-13): the collapsed repo set round-trips too —
			// the sanitize layer always writes the (possibly empty) list back.
			collapsedRepos: [],
			// Explorer Layout (amendment 2026-09-16): the open file tabs and
			// the active tab round-trip as well — the sanitize layer always
			// writes the (possibly empty) list and the active path back.
			openTabs: ['README.md'],
			activeFile: 'README.md',
			// Settings Tree D1: the explorer clamps in the WIDE file band —
			// a 600 fixture would clamp UP, so store a lane-legal width.
			width: 1000
		};
		const file: DsiPanelEntry = {
			id: 'panel-2',
			kind: 'workspace-file',
			sessionId: 'session-1',
			path: 'README.md',
			explorerPanelId: 'panel-1',
			// The File Eye (2026-09-13): the view round-trips too — the
			// sanitize layer always writes the literal back.
			view: 'edit',
			// The file lane (2026-09-13): 1024 floor — a 600 fixture would
			// clamp UP, so the fixture stores a lane-legal width.
			width: 1024
		};
		expect(isPanelEntry(explorer)).toBe(true);
		expect(isPanelEntry(file)).toBe(true);
		savePanelPrefs({
			panels: [explorer, file],
			selectedPanelId: 'panel-2',
			panelWidth: 730,
			zoom: 1
		} as PanelPrefs);
		const loaded = loadPanelPrefs();
		expect(loaded.panels).toEqual([explorer, file]);
	});

	it('PERSISTENCE — a settings-home explorer round-trips (sessionId null, title, home; Settings Tree D2/D3)', () => {
		const home: DsiPanelEntry = {
			id: 'panel-9',
			kind: 'workspace-explorer',
			sessionId: null,
			root: '/Users/x/.dsi',
			title: 'DSI - Settings',
			home: 'dsi',
			expanded: [],
			width: 860
		} as DsiPanelEntry;
		expect(isPanelEntry(home)).toBe(true);
		savePanelPrefs({ panels: [home], selectedPanelId: 'panel-9', panelWidth: 730, zoom: 1 } as PanelPrefs);
		const loaded = loadPanelPrefs();
		expect(loaded.panels[0]).toMatchObject({
			id: 'panel-9',
			kind: 'workspace-explorer',
			sessionId: null,
			root: '/Users/x/.dsi',
			title: 'DSI - Settings',
			home: 'dsi'
		});
	});

	it('PERSISTENCE — a session-less explorer WITHOUT a home plane is hard junk; junk title drops; legacy settings-editor blobs still restore', () => {
		// null sessionId but no home plane — it could fetch nothing.
		expect(
			isPanelEntry({ id: 'p1', kind: 'workspace-explorer', sessionId: null, root: '/x', width: 860 })
		).toBe(false);
		// A junk title is entry-tolerant — sanitize drops it.
		savePanelPrefs({
			panels: [
				{ id: 'p2', kind: 'workspace-explorer', sessionId: null, root: '/x', home: 'dsi', title: 7, width: 860 },
				// Legacy blob: the retired settings-editor kind still restores.
				{ id: 'p3', kind: 'settings-editor', target: 'dsh', width: 700 }
			],
			selectedPanelId: 'p2',
			panelWidth: 730,
			zoom: 1
		} as unknown as PanelPrefs);
		const loaded = loadPanelPrefs();
		const homeExplorer = loaded.panels[0] as unknown as Record<string, unknown>;
		expect(homeExplorer.sessionId).toBeNull();
		expect('title' in homeExplorer).toBe(false); // junk title sanitized away
		expect(loaded.panels[1]).toMatchObject({ id: 'p3', kind: 'settings-editor', target: 'dsh' });
	});

	it('PERSISTENCE — junk workspace shapes drop; junk expanded members clamp on load', () => {
		// Missing root — no copy-control value, hard junk.
		expect(isPanelEntry({ id: 'p1', kind: 'workspace-explorer', sessionId: 's1', width: 600 })).toBe(
			false
		);
		// Empty path — half the (sessionId, path) dedupe key.
		expect(
			isPanelEntry({ id: 'p2', kind: 'workspace-file', sessionId: 's1', path: '', width: 600 })
		).toBe(false);
		// Missing sessionId — the other half.
		expect(isPanelEntry({ id: 'p3', kind: 'workspace-file', path: 'a.md', width: 600 })).toBe(false);
		// Junk expanded MEMBERS are entry-tolerant — sanitize clamps them.
		savePanelPrefs({
			panels: [
				{
					id: 'p4',
					kind: 'workspace-explorer',
					sessionId: 's1',
					root: '/w',
					expanded: ['ok', 7, null, 'ok'],
					width: 600
				}
			],
			selectedPanelId: 'p4',
			panelWidth: 730,
			zoom: 1
		} as PanelPrefs);
		const loaded = loadPanelPrefs();
		// Non-string members drop; a duplicate path keeps its first occurrence.
		expect((loaded.panels[0] as DsiWorkspaceExplorerPanel).expanded).toEqual(['ok']);
	});
});
