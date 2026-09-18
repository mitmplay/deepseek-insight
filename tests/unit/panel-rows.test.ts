/**
 * panel-rows.test.ts — W2 task 2.2-T: the extracted sidebar-row
 * derivations (services/panels/panel-rows.ts, KB "The Floor
 * Decomposition" E1; ADR "The Manager in the Panel" D6/D10).
 *
 * Two contracts pinned:
 * 1. CONVERSATION PARITY — the extraction is verbatim: every row fact a
 *    pre-extraction route derived (title/workspace spine→cold fallback,
 *    dead, running, depth, move verbs) derives identically from the
 *    pure function.
 * 2. MANAGER ROW FACTS (ADR §8 required case) — a prompt-manager slot
 *    derives the kind-honest row: title 'Prompt Manager', running false, dead
 *    false, depth 0, no lineage keys — and never joins a spine or cold
 *    lookup even when ids collide.
 */
import { describe, expect, it } from 'vitest';
import {
	DOC_CHILD_PAINT,
	WORKSPACE_CHILD_PAINT,
	ghostPanelRowsFor,
	injectedDocTitle,
	MANAGER_ROW_TITLE,
	openSessionIdsOf,
	panelRowsFor,
	rowFactsByPanelId
} from '$lib/services/panels/panel-rows';
import { SYSTEM_PROMPT_DISPLAY_PATH } from '$lib/services/conversation/injected-shelf';
import { deriveLineage } from '$lib/services/lineage/lineage';
import { moveFactsFrom } from '$lib/services/lineage/lineage-move';
import type { DsiConversationPanel, DsiPanelEntry, DsiSessionSummary } from '$lib/types';

function row(
	sessionId: string,
	over: Partial<DsiSessionSummary> = {}
): DsiSessionSummary {
	return {
		sessionId,
		title: `Session ${sessionId}`,
		agentPreset: null,
		running: false,
		blank: false,
		updatedAt: 0,
		workspace: '/tmp/w',
		turns: null,
		...over
	};
}

function conversation(id: string, sessionId: string, width = 730): DsiConversationPanel {
	return { id, kind: 'conversation', sessionId, agentPreset: null, width };
}

function conv(panels: readonly DsiPanelEntry[]): DsiConversationPanel[] {
	return panels.filter((p): p is DsiConversationPanel => p.kind === 'conversation');
}

function manager(id: string, width = 730): DsiPanelEntry {
	return { id, kind: 'prompt-manager', width };
}

function injectedDoc(
	id: string,
	sourceSessionId: string,
	displayPath: string,
	width = 730
): DsiPanelEntry {
	return { id, kind: 'injected-doc', sourceSessionId, displayPath, width };
}

describe('panelRowsFor — conversation parity (2.2-T)', () => {
	it('title/workspace fall back spine → cold; dead/running honest; depth from lineage', () => {
		const spineRows = [
			row('s1', { title: 'Live One', workspace: '/w/a', running: true }),
			// s2 has NO spine row — the cold cache carries it
			row('s3', { parentSessionId: 's1', origin: 'subagent' })
		];
		const panels = [conversation('p1', 's1'), conversation('p2', 's2'), conversation('p3', 's3')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const moveFacts = moveFactsFrom(lineageFacts, openSessionIdsOf(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {
				s2: { title: 'Cold Two', workspace: '/w/cold', running: false }
			},
			deadSessions: { s2: '404' },
			edgeCache: {},
			lineageFacts,
			moveFacts
		});
		expect(rows.map((r) => r.title)).toEqual(['Live One', 'Cold Two', 'Session s3']);
		expect(rows.map((r) => r.workspace)).toEqual(['/w/a', '/w/cold', '/tmp/w']);
		expect(rows.map((r) => r.dead)).toEqual([false, true, false]);
		expect(rows.map((r) => r.running)).toEqual([true, false, false]);
		// s3 is pinned under the OPEN s1 → depth 1 (lineage fact).
		expect(rows.map((r) => r.depth)).toEqual([0, 0, 1]);
	});

	it('rowFactsByPanelId keys every row by panel id (header chevron source)', () => {
		const panels = [conversation('p1', 's1'), manager('m1')];
		const lineageFacts = deriveLineage([], conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows: [],
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		const facts = rowFactsByPanelId(rows);
		expect([...facts.keys()].sort()).toEqual(['m1', 'p1']);
	});
});

describe('panelRowsFor — manager row facts (ADR §8 required case)', () => {
	it('a prompt-manager slot derives the kind-honest row', () => {
		const spineRows = [row('s1', { title: 'Conversation', running: true })];
		const panels = [conversation('p1', 's1'), manager('m1'), conversation('p2', 's2')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			// A cold row under the MANAGER's panel id must not leak in.
			coldCache: { m1: { title: 'Spoof', workspace: '/nope', running: true } },
			deadSessions: { m1: '404' },
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		const mgr = rows[1];
		expect(mgr.title).toBe(MANAGER_ROW_TITLE);
		expect(mgr.running).toBe(false);
		expect(mgr.dead).toBe(false);
		expect(mgr.depth).toBe(0);
		expect(mgr.runningDescendants).toBe(0);
		expect(mgr.parentSessionId).toBeNull();
		expect(mgr.fork).toBe(false);
		expect(mgr.spawnerTitle).toBeNull();
		expect(mgr.kind).toBe('panel');
		// Move verbs are positional: the middle slot moves both ways.
		expect(mgr.canMoveUp).toBe(true);
		expect(mgr.canMoveDown).toBe(true);
	});

	it('the open-session view is conversation-only — a manager id never joins it', () => {
		const panels = [conversation('p1', 's1'), manager('m1')];
		expect(openSessionIdsOf(panels)).toEqual(new Set(['s1']));
	});

	it('ghosts derive from conversation panels only; a manager spawner ghosts nothing', () => {
		const spineRows = [
			row('s1'),
			row('agent1', { parentSessionId: 's1', origin: 'subagent' })
		];
		const panels = [conversation('p1', 's1'), manager('m1')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const ghosts = ghostPanelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(ghosts.map((g) => g.panel.id)).toEqual(['ghost-agent1']);
		expect(ghosts[0].kind).toBe('ghost');
	});
});

// ── Loadinjected W1 1.2-T — the document-child row (2026-09-07 ADR D3/D7) ──

describe('panelRowsFor — document-child row facts (Loadinjected ADR D3)', () => {
	it('an injected-doc slot derives the row-level lineage child', () => {
		const spineRows = [row('s1', { title: 'Conversation', running: true })];
		const panels = [
			conversation('p1', 's1'),
			injectedDoc('d1', 's1', 'AGENTS.md'),
			conversation('p2', 's2')
		];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		const doc = rows[1];
		expect(doc.title).toBe('AGENTS.md');
		expect(doc.parentSessionId).toBe('s1');
		expect(doc.depth).toBe(1);
		expect(doc.fork).toBe(false);
		expect(doc.spawnerTitle).toBeNull();
		expect(doc.running).toBe(false);
		expect(doc.dead).toBe(false);
		expect(doc.workspace).toBeNull();
		expect(doc.runningDescendants).toBe(0);
		expect(doc.kind).toBe('panel');
		// The FAMILY grammar (consolidated 2026-09-07): a document child
		// travels with its source — moves are not offered (the manager's
		// positional verbs are not this row's grammar).
		expect(doc.canMoveUp).toBe(false);
		expect(doc.canMoveDown).toBe(false);
	});

	it('depth is FLAT 1 — no spine join, no orphan degrade, no id-collision leaks', () => {
		const spineRows = [row('s9', { title: 'Spoof', running: true })];
		const panels = [injectedDoc('d1', 's9', 'AGENTS.md')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			// Cold/dead/edge facts under the SOURCE session id must not leak
			// in — the doc row renders a record, not the session.
			coldCache: { s9: { title: 'Cold Spoof', workspace: '/nope', running: true } },
			deadSessions: { s9: '404' },
			edgeCache: { s9: 'edge-parent' },
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(rows[0].depth).toBe(1);
		expect(rows[0].dead).toBe(false);
		expect(rows[0].running).toBe(false);
		expect(rows[0].parentSessionId).toBe('s9');
		expect(rows[0].spawnerTitle).toBeNull();
		expect(rows[0].workspace).toBeNull();
	});

	it('title: the synthetic system-prompt member reads the D7 pinned label', () => {
		expect(injectedDocTitle('AGENTS.md')).toBe('AGENTS.md');
		expect(injectedDocTitle('docs/nested/RULES.md')).toBe('docs/nested/RULES.md');
		expect(injectedDocTitle(SYSTEM_PROMPT_DISPLAY_PATH)).toBe('system prompt — latest epoch');
	});

	it('the maroon document-child paint is the pinned #800000 constant', () => {
		expect(DOC_CHILD_PAINT).toBe('#800000');
	});

	it('the open-session view stays conversation-only — a doc source never joins it', () => {
		const panels = [conversation('p1', 's1'), injectedDoc('d1', 's1', 'AGENTS.md')];
		expect(openSessionIdsOf(panels)).toEqual(new Set(['s1']));
	});

	it('ghosts derive from conversation panels only — a doc panel ghosts nothing', () => {
		const spineRows = [
			row('s1'),
			row('agent1', { parentSessionId: 's1', origin: 'subagent' })
		];
		const panels = [conversation('p1', 's1'), injectedDoc('d1', 's1', 'AGENTS.md')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const ghosts = ghostPanelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(ghosts.map((g) => g.panel.id)).toEqual(['ghost-agent1']);
	});
});

// ── Workspace rows — Shared Tree ADR (2026-09-17, D3): the explorer is a
// NON-family panel; its row reads exactly like a root (non-fork)
// conversation row. The file still anchors to its explorer (the
// below-explorer slot rule stands, D4 defers its re-key).

function explorerPanel(id: string, sessionId: string): DsiPanelEntry {
	return { id, kind: 'workspace-explorer', sessionId, root: '/w/a', expanded: [], width: 600 };
}

function filePanel(id: string, sessionId: string, explorerPanelId: string | null): DsiPanelEntry {
	return { id, kind: 'workspace-file', sessionId, path: 'AGENTS.md', explorerPanelId, width: 600 };
}

describe('panelRowsFor — workspace rows are root-like (Shared Tree D3)', () => {
	it('a ROOT conversation: the explorer row is a root row — depth 0, movable, no branch', () => {
		const spineRows = [row('s1')];
		const panels = [
			conversation('p1', 's1'),
			explorerPanel('e1', 's1'),
			filePanel('f1', 's1', 'e1')
		];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(rows.map((r) => r.depth)).toEqual([0, 0, 0]);
		expect(rows[1].title).toBe('a'); // root basename
		expect(rows[2].title).toBe('AGENTS.md');
		expect(rows[1].parentSessionId).toBeNull(); // no conversation edge (D3)
		expect(rows[1].wsChild).toBeUndefined(); // no lineage branch paint
		expect(rows[1].canMoveUp).toBe(true); // the same grammar every root row uses
		// explorer unit [e1, f1] is the LAST block — down is at its edge (null).
		expect(rows[1].canMoveDown).toBe(false);
	});

	it('a FORK conversation does not lift the explorer: depth 0 all the same', () => {
		const spineRows = [row('root'), row('s1', { parentSessionId: 'root' })];
		const panels = [
			conversation('p0', 'root'),
			conversation('p1', 's1'),
			explorerPanel('e1', 's1'),
			filePanel('f1', 's1', 'e1')
		];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(rows.map((r) => r.depth)).toEqual([0, 1, 0, 0]);
	});

	it('workspace rows carry NO wsChild paint — the explorer is not a spawned child', () => {
		const spineRows = [row('s1')];
		const panels = [
			conversation('p1', 's1'),
			explorerPanel('e1', 's1'),
			filePanel('f1', 's1', 'e1')
		];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(rows[1].wsChild).toBeUndefined();
		expect(rows[2].wsChild).toBeUndefined();
	});

	it('conversation off the floor: the rows are unchanged roots (no orphan degrade needed)', () => {
		const spineRows = [row('s1')];
		const panels = [explorerPanel('e1', 's1'), filePanel('f1', 's1', 'e1')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(rows.map((r) => r.depth)).toEqual([0, 0]);
	});

	it('file with no explorer panel: still a root-like row (depth 0)', () => {
		const spineRows = [row('s1')];
		const panels = [conversation('p1', 's1'), filePanel('f1', 's1', null)];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(rows.map((r) => r.depth)).toEqual([0, 0]);
	});
});