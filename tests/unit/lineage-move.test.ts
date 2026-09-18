/**
 * lineage-move.test.ts — task 1.2-T (spec: 2026-08-27 DSI Sub-Agent Lineage
 * Sidebar). Pins the Lineage Pin invariants I1–I3 after EVERY operation,
 * the ADR worked example as exact expected order, and replaceTarget's
 * placement decisions.
 */
import { describe, expect, it } from 'vitest';
import { deriveLineage, type LineageFacts } from '$lib/services/lineage/lineage';
import {
	moveFactsFrom,
	movePanelLineage,
	replaceTarget,
	afterSourceSlot
} from '$lib/services/lineage/lineage-move';
import { docTailEnd } from '$lib/services/lineage/lineage-move';
import type { DsiConversationPanel, DsiPanelEntry, DsiSessionSummary } from '$lib/types';

function row(sessionId: string, over: Partial<DsiSessionSummary> = {}): DsiSessionSummary {
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

/** Panels keyed by session id (ids unique per session here). */
function panelsOf(...sessionIds: string[]): DsiConversationPanel[] {
	return sessionIds.map((sessionId) => ({
		id: `p-${sessionId}`,
		kind: 'conversation',
		sessionId,
		agentPreset: null,
		width: 0.5
	}));
}

/** Feed where every listed id exists; `parent:child` pairs make sub-agents. */
function feedOf(roots: string[], childrenOf: Record<string, string[]>): DsiSessionSummary[] {
	const rows = roots.map((id) => row(id));
	for (const [parent, kids] of Object.entries(childrenOf)) {
		for (const kid of kids) rows.push(row(kid, { parentSessionId: parent, origin: 'subagent' }));
	}
	return rows;
}

const idOf = (panels: DsiPanelEntry[]): string[] =>
	panels.map((p) => (p.kind === 'conversation' ? p.sessionId : p.id));

/** Floor-membership set for the move facts (W6: parent edges count only
 *  while the spawner holds a panel — off-floor spawners root orphans). */
const openOf = (...sessionIds: string[]): ReadonlySet<string> => new Set(sessionIds);

/** I1+I2: every child sits in the contiguous block directly below its parent. */
function assertPinHolds(mixed: DsiPanelEntry[], facts: LineageFacts): void {
	const panels = mixed.filter((p): p is DsiConversationPanel => p.kind === 'conversation');
	const parentOf = moveFactsFrom(facts, new Set(panels.map((p) => p.sessionId))).parentOf;
	for (const panel of panels) {
		const parent = parentOf.get(panel.sessionId) ?? null;
		if (parent === null) continue;
		const childIdx = panels.findIndex((p) => p.sessionId === panel.sessionId);
		const parentIdx = panels.findIndex((p) => p.sessionId === parent);
		expect(parentIdx, `parent of ${panel.sessionId} on floor`).toBeGreaterThanOrEqual(0);
		expect(childIdx, `child below parent`).toBeGreaterThan(parentIdx);
		// contiguity: nothing between parent and child that is not family
		for (let i = parentIdx + 1; i < childIdx; i++) {
			const between = panels[i].sessionId;
			const betweenParent = parentOf.get(between) ?? null;
			const isFamily =
				betweenParent === parent ||
				(betweenParent !== null && parentOf.get(betweenParent) === parent) === false
					? betweenParent === parent || betweenParent === panel.sessionId
					: true;
			expect(
				isFamily || betweenParent === panel.sessionId,
				`non-family ${between} between ${parent} and ${panel.sessionId}`
			).toBe(true);
		}
	}
}

describe('movePanelLineage — child clamping (unreachable, not blocked)', () => {
	const feed = feedOf(['s1', 'main', 's3'], { main: ['kidA', 'kidB'] });
	const facts = deriveLineage(feed);
	const move = moveFactsFrom(facts, openOf('s1', 'main', 'kidA', 'kidB', 's3'));

	it('first child UP is not offered (null — button hidden)', () => {
		const panels = panelsOf('s1', 'main', 'kidA', 'kidB', 's3');
		expect(movePanelLineage(panels, 'p-kidA', 'up', move)).toBeNull();
	});

	it('last child DOWN is not offered (null — button hidden)', () => {
		const panels = panelsOf('s1', 'main', 'kidA', 'kidB', 's3');
		expect(movePanelLineage(panels, 'p-kidB', 'down', move)).toBeNull();
	});

	it('siblings swap freely within the range; pin holds', () => {
		const panels = panelsOf('s1', 'main', 'kidA', 'kidB', 's3');
		const next = movePanelLineage(panels, 'p-kidA', 'down', move);
		expect(next).not.toBeNull();
		expect(idOf(next!)).toEqual(['s1', 'main', 'kidB', 'kidA', 's3']);
		assertPinHolds(next!, facts);
	});
});

describe('movePanelLineage — the ADR worked example', () => {
	const feed = feedOf(['s1', 's2', 's3', 's4'], { s2: ['agent1', 'agent2'] });
	const facts = deriveLineage(feed);

	it('childless root (s3) UP leaps the whole family block — never re-parents', () => {
		// Pre-close state: agent1 is a real panel; agent2 is a ghost (no panel).
		const move = moveFactsFrom(facts, openOf('s1', 's2', 'agent1', 's3', 's4'));
		const panels = panelsOf('s1', 's2', 'agent1', 's3', 's4');
		const next = movePanelLineage(panels, 'p-s3', 'up', move);
		expect(idOf(next!)).toEqual(['s1', 's3', 's2', 'agent1', 's4']); // ✓ ADR outcome
		assertPinHolds(next!, facts);
	});

	it('family (s2) DOWN over childless root lands the same order (symmetric)', () => {
		const move = moveFactsFrom(facts, openOf('s1', 's2', 'agent1', 's3', 's4'));
		const panels = panelsOf('s1', 's2', 'agent1', 's3', 's4');
		const next = movePanelLineage(panels, 'p-s2', 'down', move);
		expect(idOf(next!)).toEqual(['s1', 's3', 's2', 'agent1', 's4']);
		assertPinHolds(next!, facts);
	});

	it('post-close swap: s2 unit (no real children) swaps with s3 plainly', () => {
		const move = moveFactsFrom(facts, openOf('s1', 's2', 's3', 's4'));
		const panels = panelsOf('s1', 's2', 's3', 's4');
		const next = movePanelLineage(panels, 'p-s2', 'down', move);
		expect(idOf(next!)).toEqual(['s1', 's3', 's2', 's4']);
	});
});

// W6 deviation fix 2: an orphan child panel (spawner alive in the spine but
// OFF the floor — the ADR D6 close-parent case) moves FREELY as its own
// unit (ADR §8 control matrix: "free — it IS the unit now"). Before W6 the
// move facts were spine-derived, so the orphan's neighbors were never
// siblings and BOTH buttons hid forever (probe-verified 2026-08-27).
describe('movePanelLineage — orphan child panels move freely (ADR §8)', () => {
	const feed = feedOf(['s1', 'parent', 's2'], { parent: ['child'] });
	const facts = deriveLineage(feed);
	// The floor after closing the parent's panel: strangers around the child.
	const open = openOf('s1', 'child', 's2');

	it('orphan between strangers moves up and down (not offered → offered)', () => {
		const move = moveFactsFrom(facts, open);
		const panels = panelsOf('s1', 'child', 's2');
		expect(idOf(movePanelLineage(panels, 'p-child', 'up', move)!)).toEqual([
			'child',
			's1',
			's2'
		]);
		expect(idOf(movePanelLineage(panels, 'p-child', 'down', move)!)).toEqual([
			's1',
			's2',
			'child'
		]);
	});

	it('orphan keeps its own descendants as its unit (the pin is recursive)', () => {
		const deep = feedOf(['s1', 'parent', 's2'], { parent: ['child'], child: ['grand'] });
		const move = moveFactsFrom(deriveLineage(deep), openOf('s1', 'child', 'grand', 's2'));
		const panels = panelsOf('s1', 'child', 'grand', 's2');
		const next = movePanelLineage(panels, 'p-child', 'up', move);
		expect(idOf(next!)).toEqual(['child', 'grand', 's1', 's2']); // unit moved as one
	});

	it('child with spawner ON the floor still clamps (pin unchanged)', () => {
		const move = moveFactsFrom(facts, openOf('s1', 'parent', 'child', 's2'));
		const panels = panelsOf('s1', 'parent', 'child', 's2');
		// First child UP would cross the family boundary — not offered.
		expect(movePanelLineage(panels, 'p-child', 'up', move)).toBeNull();
	});

	it('sibling orphans of one off-floor spawner each head their own unit', () => {
		const twin = feedOf(['s1', 'parent', 's2'], { parent: ['kidA', 'kidB'] });
		const move = moveFactsFrom(deriveLineage(twin), openOf('s1', 'kidA', 'kidB', 's2'));
		const panels = panelsOf('s1', 'kidA', 'kidB', 's2');
		// kidA is not the unit's bottom edge (kidB is) but has no sibling ABOVE
		// within the family — the spawner is gone, so each orphan is free.
		expect(idOf(movePanelLineage(panels, 'p-kidA', 'up', move)!)).toEqual([
			'kidA',
			's1',
			'kidB',
			's2'
		]);
	});
});

describe('movePanelLineage — unit atomicity (I3) under random legal ops', () => {
	it('property pass: pin holds after a sequence of legal moves', () => {
		const feed = feedOf(['r1', 'r2', 'r3'], { r2: ['c1', 'c2'], c1: ['g1'] });
		const facts = deriveLineage(feed);
		const move = moveFactsFrom(facts, openOf('r1', 'r2', 'c1', 'g1', 'c2', 'r3'));
		let panels: DsiPanelEntry[] = panelsOf('r1', 'r2', 'c1', 'g1', 'c2', 'r3');
		// deterministic pseudo-random sequence of legal moves
		const moves: Array<[string, 'up' | 'down']> = [
			['r1', 'down'], ['c2', 'up'], ['r3', 'up'], ['g1', 'down'], ['r2', 'up'],
			['c1', 'down'], ['r3', 'up'], ['r1', 'down'], ['c2', 'down'], ['r2', 'down']
		];
		for (const [sessionId, dir] of moves) {
			const next = movePanelLineage(panels, `p-${sessionId}`, dir, move);
			if (next === null) continue; // not offered — fine
			panels = next;
			assertPinHolds(panels, facts);
		}
		expect(idOf(panels)).toEqual(['r3', 'r1', 'r2', 'c1', 'g1', 'c2']);
	});
});

describe('replaceTarget — a sub-agent never travels alone', () => {
	const feed = feedOf(['s1', 'main', 's3'], { main: ['kid'] });
	const facts = deriveLineage(feed);

	it('plain session → plain placement', () => {
		expect(replaceTarget(panelsOf('main'), 's1', facts)).toEqual({ kind: 'plain' });
	});

	it('sub-agent with spawner on floor → pinned at parentIndex + 1', () => {
		const panels = panelsOf('s1', 'main', 's3');
		expect(replaceTarget(panels, 'kid', facts)).toEqual({
			kind: 'pinned',
			parentSessionId: 'main',
			index: 2
		});
	});

	it('sub-agent with spawner OFF floor → adopt the family', () => {
		expect(replaceTarget(panelsOf('s1', 's3'), 'kid', facts)).toEqual({
			kind: 'adopt-family',
			parentSessionId: 'main'
		});
	});

	it('orphan sub-agent → plain (root behavior, I4)', () => {
		const orphanFeed = [row('orphan', { parentSessionId: 'gone', origin: 'subagent' })];
		expect(replaceTarget(panelsOf('s1'), 'orphan', deriveLineage(orphanFeed))).toEqual({
			kind: 'plain'
		});
	});
});

describe('afterSourceSlot — the fork lands below its source (2026-09-01)', () => {
	it('lone source mid-floor: the source keeps its index, the child takes the next one', () => {
		const move = moveFactsFrom(deriveLineage(feedOf(['a', 'b', 'c'], {})), openOf('a', 'b', 'c'));
		expect(afterSourceSlot(panelsOf('a', 'b', 'c'), 'b', move)).toBe(2);
	});

	it('family head with pinned children: the slot rides PAST the whole unit (never wedges)', () => {
		const feed = feedOf(['src', 'x'], { src: ['kid1', 'kid2'] });
		const move = moveFactsFrom(deriveLineage(feed), openOf('src', 'kid1', 'kid2', 'x'));
		expect(afterSourceSlot(panelsOf('src', 'kid1', 'kid2', 'x'), 'src', move)).toBe(3);
	});

	it('family child source: past its own unit, still inside nothing (I2 intact)', () => {
		const feed = feedOf(['src', 'x'], { src: ['kid'] });
		const move = moveFactsFrom(deriveLineage(feed), openOf('src', 'kid', 'x'));
		expect(afterSourceSlot(panelsOf('src', 'kid', 'x'), 'kid', move)).toBe(2);
	});

	it('last panel of the floor: panels.length (insertPanel clamps the splice)', () => {
		const move = moveFactsFrom(deriveLineage(feedOf(['a', 'b'], {})), openOf('a', 'b'));
		expect(afterSourceSlot(panelsOf('a', 'b'), 'b', move)).toBe(2);
	});

	it('source off-floor → null (the caller falls back)', () => {
		const move = moveFactsFrom(deriveLineage(feedOf(['a'], {})), openOf('a'));
		expect(afterSourceSlot(panelsOf('a'), 'gone', move)).toBeNull();
	});
});

// The 2026-09-01 fork amendment: move facts ride the family edges, not
// the origin kind — fork children are pinned, clampable members and the
// parent's unit carries them. Live trigger: the session-35fe1249 family
// (one original + four forks), where fork rows carried depth 0 and root
// move semantics, so a sidebar move-up leapt a fork above its own parent
// while the render kept the family grouped under the head (split-brain).
describe('movePanelLineage — fork children are pinned family (2026-09-01)', () => {
	const feed = [
		row('s1'),
		row('main'),
		row('fork1', { parentSessionId: 'main' }),
		row('fork2', { parentSessionId: 'main' }),
		row('s3')
	];
	const facts = deriveLineage(feed);
	const move = moveFactsFrom(facts, openOf('s1', 'main', 'fork1', 'fork2', 's3'));

	it('first fork child UP is not offered (null — would cross the parent)', () => {
		const panels = panelsOf('s1', 'main', 'fork1', 'fork2', 's3');
		expect(movePanelLineage(panels, 'p-fork1', 'up', move)).toBeNull();
	});

	it('last fork child DOWN is not offered (null — stranger below ends the range)', () => {
		const panels = panelsOf('s1', 'main', 'fork1', 'fork2', 's3');
		expect(movePanelLineage(panels, 'p-fork2', 'down', move)).toBeNull();
	});

	it('fork siblings swap within the range; the pin holds', () => {
		const panels = panelsOf('s1', 'main', 'fork1', 'fork2', 's3');
		const next = movePanelLineage(panels, 'p-fork1', 'down', move);
		expect(idOf(next!)).toEqual(['s1', 'main', 'fork2', 'fork1', 's3']);
		assertPinHolds(next!, facts);
	});

	it('the parent unit INCLUDES fork children — main down leaps the whole family', () => {
		// The live tear: the unit saw only sub-agent descendants, so the
		// parent swapped past fork1 and stranded the family.
		const panels = panelsOf('s1', 'main', 'fork1', 'fork2', 's3');
		const next = movePanelLineage(panels, 'p-main', 'down', move);
		expect(idOf(next!)).toEqual(['s1', 's3', 'main', 'fork1', 'fork2']);
		assertPinHolds(next!, facts);
	});

	it('a childless root leaps a FORK family block in one step (blockBounds widened)', () => {
		const panels = panelsOf('s1', 'main', 'fork1', 'fork2', 's3');
		const next = movePanelLineage(panels, 'p-s1', 'down', move);
		expect(idOf(next!)).toEqual(['main', 'fork1', 'fork2', 's1', 's3']);
		assertPinHolds(next!, facts);
	});

	it('afterSourceSlot rides past the whole fork family (the wedge fix)', () => {
		// Before the amendment the unit saw no fork children and slotted a
		// new fork at parentIndex+1 — wedged between the head and fork1.
		expect(afterSourceSlot(panelsOf('main', 'fork1', 'fork2', 's3'), 'main', move)).toBe(3);
	});
});

describe('replaceTarget — fork placement (2026-09-01)', () => {
	const feed = [
		row('s1'),
		row('main'),
		row('fork', { parentSessionId: 'main' }),
		row('orphan', { parentSessionId: 'gone' })
	];
	const facts = deriveLineage(feed);

	it('fork with parent on floor → pinned below it (the Lineage Pin files it)', () => {
		expect(replaceTarget(panelsOf('s1', 'main'), 'fork', facts)).toEqual({
			kind: 'pinned',
			parentSessionId: 'main',
			index: 2
		});
	});

	it('fork with parent OFF floor → plain (a fork stands alone — never adopt-family)', () => {
		expect(replaceTarget(panelsOf('s1'), 'fork', facts)).toEqual({ kind: 'plain' });
	});

	it('orphan fork → plain (I4)', () => {
		expect(replaceTarget(panelsOf('s1'), 'orphan', facts)).toEqual({ kind: 'plain' });
	});
});

// ── Loadinjected consolidation (2026-09-07) — the family block includes
// its DOCUMENT children: one movement grammar for all three child kinds
// (fork, sub-agent, injected-doc). ADR D3's row-level lineage, carried by
// the block math instead of the session-typed map.

function doc(id: string, sourceSessionId: string): DsiPanelEntry {
	return { id, kind: 'injected-doc', sourceSessionId, displayPath: 'AGENTS.md', width: 0.5 };
}

describe('docTailEnd — the contiguous document tail (Loadinjected ADR D3)', () => {
	it('walks the run of documents belonging to the source; stops at strangers', () => {
		const panels = [
			panelsOf('A')[0],
			doc('d1', 'A'),
			doc('d2', 'A'),
			panelsOf('B')[0],
			doc('dX', 'B')
		];
		expect(docTailEnd(panels, 0, 'A')).toBe(2);
		expect(docTailEnd(panels, 0, 'B')).toBe(0); // A's docs are not B's
		expect(docTailEnd(panelsOf('A', 'B'), 0, 'A')).toBe(0); // no docs
	});
});

describe('movePanelLineage — a parent move carries its document children', () => {
	function factsFor(sessionIds: string[], panels: readonly DsiPanelEntry[]) {
		const lineage = deriveLineage(sessionIds.map((id) => row(id)), panels.filter(
			(p): p is DsiConversationPanel => p.kind === 'conversation'
		));
		return moveFactsFrom(lineage, new Set(sessionIds));
	}

	it('moving the parent leaps the neighbor block; the doc child travels below it', () => {
		const panels = [...panelsOf('A', 'B'), doc('d1', 'A')];
		const facts = factsFor(['A', 'B'], panels);
		const next = movePanelLineage(panels, 'p-A', 'down', facts);
		// The unit [A + doc] leaps B whole — the doc child is never stranded.
		expect(next?.map((p) => p.id)).toEqual(['p-B', 'p-A', 'd1']);
	});

	it('a neighbor crossing a doc child leaps the child WITH its source', () => {
		const panels = [...panelsOf('A', 'B'), doc('d1', 'A')];
		const facts = factsFor(['A', 'B'], panels);
		// B moves up: its above-neighbor is the doc child — the block is
		// A's whole family block, never the doc child alone.
		const next = movePanelLineage(panels, 'p-B', 'up', facts);
		expect(next?.map((p) => p.id)).toEqual(['p-B', 'p-A', 'd1']);
	});

	it('the doc tail rides nested families too (a fork child with its own doc)', () => {
		// A's family: fork child F pinned below A; F received its own doc,
		// and A's own doc closes the block — a stranger B follows.
		const panels = [...panelsOf('A', 'F'), doc('dF', 'F'), doc('dA', 'A'), ...panelsOf('B')];
		const lineage = deriveLineage(
			[row('A'), row('F', { parentSessionId: 'A' })],
			panels.filter((p): p is DsiConversationPanel => p.kind === 'conversation')
		);
		const facts = moveFactsFrom(lineage, new Set(['A', 'F']));
		const next = movePanelLineage(panels, 'p-A', 'down', facts);
		// A's block = A + F + F's doc + A's doc — the family travels whole.
		expect(next?.map((p) => p.id)).toEqual(['p-B', 'p-A', 'p-F', 'dF', 'dA']);
	});
});

// ── Workspace explorer/file lineage (2026-09-10 fix) — the file panels
// travel with their explorer (explorerUnit), the tail walker carries the
// workspace tail with the family, and a stored/null explorer edge both
// resolve. ADR: The Workspace Explorer, post-implementation amendment.

function explorer(id: string, sessionId: string): DsiPanelEntry {
	return { id, kind: 'workspace-explorer', sessionId, root: '/tmp/w', expanded: [], width: 0.5 };
}

function wfile(
	id: string,
	sessionId: string,
	path: string,
	explorerPanelId: string | null
): DsiPanelEntry {
	return { id, kind: 'workspace-file', sessionId, path, explorerPanelId, width: 0.5 };
}

describe('movePanelLineage — a workspace-file travels with its explorer (2026-09-10)', () => {
	function factsFor(sessionIds: string[], panels: readonly DsiPanelEntry[]) {
		const lineage = deriveLineage(
			sessionIds.map((id) => row(id)),
			panels.filter((p): p is DsiConversationPanel => p.kind === 'conversation')
		);
		return moveFactsFrom(lineage, new Set(sessionIds));
	}

	it('moving the explorer carries its file children as one unit', () => {
		const panels = [...panelsOf('A', 'B'), explorer('e1', 'A'), wfile('f1', 'A', 'a.ts', 'e1')];
		const next = movePanelLineage(panels, 'e1', 'up', factsFor(['A', 'B'], panels));
		// The unit [explorer + file] leaps B whole — the file is never stranded.
		expect(next?.map((p) => p.id)).toEqual(['p-A', 'e1', 'f1', 'p-B']);
	});

	it('moving a file panel moves the explorer unit (never alone)', () => {
		const panels = [...panelsOf('A', 'B'), explorer('e1', 'A'), wfile('f1', 'A', 'a.ts', 'e1')];
		const next = movePanelLineage(panels, 'f1', 'up', factsFor(['A', 'B'], panels));
		expect(next?.map((p) => p.id)).toEqual(['p-A', 'e1', 'f1', 'p-B']);
	});

	it('a neighbor crossing a file leaps the explorer WITH its files', () => {
		const panels = [...panelsOf('A', 'B'), explorer('e1', 'A'), wfile('f1', 'A', 'a.ts', 'e1')];
		const next = movePanelLineage(panels, 'p-B', 'up', factsFor(['A', 'B'], panels));
		expect(next?.map((p) => p.id)).toEqual(['p-B', 'p-A', 'e1', 'f1']);
	});

	it('the legacy null edge still binds by adjacency + shared session', () => {
		const panels = [...panelsOf('A', 'B'), explorer('e1', 'A'), wfile('f1', 'A', 'a.ts', null)];
		const next = movePanelLineage(panels, 'e1', 'up', factsFor(['A', 'B'], panels));
		expect(next?.map((p) => p.id)).toEqual(['p-A', 'e1', 'f1', 'p-B']);
	});

	it('the direct edge binds regardless of the file session (route-minted invariant)', () => {
		// The route only mints edges from the explorer's own session, so a
		// mismatched edge cannot occur in practice; this pins that the EDGE
		// — not a session re-check — is the binding fact.
		const panels = [panelsOf('A')[0], explorer('e1', 'A'), wfile('fX', 'B', 'b.ts', 'e1'), panelsOf('B')[0]];
		// The explorer's block is its OWN unit (Shared Tree D3: a non-family
		// panel) — the move leaps the conversation A whole, never the family.
		const next = movePanelLineage(panels, 'e1', 'down', factsFor(['A', 'B'], panels));
		// down = swap with the NEXT block whole: p-B leaps past the unit.
		expect(next?.map((p) => p.id)).toEqual(['p-A', 'p-B', 'e1', 'fX']);
	});

	it('moving the conversation does NOT carry the explorer (Shared Tree D3)', () => {
		const feed = [row('A'), row('F', { parentSessionId: 'A' })];
		const panels = [
			...panelsOf('A', 'F'),
			explorer('e1', 'A'),
			wfile('f1', 'A', 'a.ts', 'e1'),
			...panelsOf('B')
		];
		const lineage = deriveLineage(
			feed,
			panels.filter((p): p is DsiConversationPanel => p.kind === 'conversation')
		);
		const facts = moveFactsFrom(lineage, new Set(['A', 'F']));
		const next = movePanelLineage(panels, 'p-A', 'down', facts);
		// A's block = A + F only; it crosses the workspace unit as ONE whole
		// neighbor block — the explorer is never INSIDE the family block.
		expect(next?.map((p) => p.id)).toEqual(['e1', 'f1', 'p-A', 'p-F', 'p-B']);
	});
});

describe('docTailEnd — DOCUMENTS ONLY (2026-09-10 order fix)', () => {
	it('walks the doc run; the workspace tail does NOT displace pinned session children', () => {
		const panels = [
			panelsOf('A')[0],
			doc('d1', 'A'),
			explorer('e1', 'A'),
			wfile('f1', 'A', 'a.ts', 'e1'),
			panelsOf('B')[0]
		];
		// A session child pins at 1 — directly below its parent (the Lineage
		// Pin) — pushing the workspace pair right. The pair's membership
		// lives in unitOf/explorerUnit, never in this tail walk.
		expect(docTailEnd(panels, 0, 'A')).toBe(1);
		expect(docTailEnd(panels, 0, 'B')).toBe(0);
	});
});
