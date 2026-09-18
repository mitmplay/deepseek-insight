/**
 * lineage-derive.test.ts — task 1.1-T (spec: 2026-08-27 DSI Sub-Agent
 * Lineage Sidebar). Pins deriveLineage, ghostRowsFor, suppressFromSpine,
 * insertionIndex against the ADR's live-run-verified behaviors:
 * depth chains, recursive roll-up (through idle middles), orphan degrade,
 * cycle fail-soft, ghost membership, no double-listing, and the pin.
 */
import { describe, expect, it } from 'vitest';
import {
	deriveLineage,
	familyRenderOrder,
	ghostRowsFor,
	insertionIndex,
	nestSpineFamilies,
	suppressFromSpine
} from '$lib/services/lineage/lineage';
import type { DsiConversationPanel, DsiSessionSummary } from '$lib/types';

/** Fixture row — OPTIONAL fields exercise the `?? null` contract (task 1.3). */
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

function panel(sessionId: string): DsiConversationPanel {
	return { id: `p-${sessionId}`, kind: 'conversation', sessionId, agentPreset: null, width: 0.5 };
}

describe('deriveLineage — depth and family map', () => {
	it('roots are depth 0; children 1; grandchildren 2 (live-run shape)', () => {
		const facts = deriveLineage([
			row('main'),
			row('child', { parentSessionId: 'main', origin: 'subagent' }),
			row('grand', { parentSessionId: 'child', origin: 'subagent' })
		]);
		expect(facts.depthById.get('main')).toBe(0);
		expect(facts.depthById.get('child')).toBe(1);
		expect(facts.depthById.get('grand')).toBe(2);
		expect(facts.childrenByParent.get('main')?.map((r) => r.sessionId)).toEqual(['child']);
		expect(facts.childrenByParent.get('child')?.map((r) => r.sessionId)).toEqual(['grand']);
	});

	it('null and absent parentSessionId are the same root contract', () => {
		const facts = deriveLineage([row('a', { parentSessionId: null }), row('b')]);
		expect(facts.depthById.get('a')).toBe(0);
		expect(facts.depthById.get('b')).toBe(0);
		expect(facts.subagentIds.size).toBe(0);
	});

	it('orphan degrades to root — never dropped (I4)', () => {
		const facts = deriveLineage([
			row('ghost-child', { parentSessionId: 'gone', origin: 'subagent' })
		]);
		expect(facts.depthById.get('ghost-child')).toBe(0);
		expect(facts.subagentIds.has('ghost-child')).toBe(true);
	});

	it('cycle fails soft: members emit as roots, nothing lost', () => {
		const facts = deriveLineage([
			row('a', { parentSessionId: 'b', origin: 'subagent' }),
			row('b', { parentSessionId: 'a', origin: 'subagent' })
		]);
		expect(facts.depthById.get('a')).toBe(0);
		expect(facts.depthById.get('b')).toBe(0);
		expect(facts.subagentIds.size).toBe(2);
	});
});

describe('deriveLineage — running roll-up', () => {
	it('credits every ancestor: badge x2 while two run, x1 after inner settles', () => {
		const factsAt = (grandRunning: boolean, childRunning: boolean) =>
			deriveLineage([
				row('main'),
				row('child', { parentSessionId: 'main', origin: 'subagent', running: childRunning }),
				row('grand', { parentSessionId: 'child', origin: 'subagent', running: grandRunning })
			]);
		const both = factsAt(true, true);
		expect(both.runningDescendants.get('main')).toBe(2);
		expect(both.runningDescendants.get('child')).toBe(1);
		const deflated = factsAt(false, true);
		expect(deflated.runningDescendants.get('main')).toBe(1); // x2 → x1
	});

	it('rolls up through an IDLE middle hop (overlap run shape)', () => {
		const facts = deriveLineage([
			row('main'),
			row('child', { parentSessionId: 'main', origin: 'subagent', running: false }),
			row('grand', { parentSessionId: 'child', origin: 'subagent', running: true })
		]);
		expect(facts.runningDescendants.get('main')).toBe(1);
		expect(facts.runningDescendants.get('child')).toBe(1);
	});

	it('cycle in the ancestor walk never double-credits (seen-set cut)', () => {
		const facts = deriveLineage([
			row('a', { parentSessionId: 'b', origin: 'subagent', running: true }),
			row('b', { parentSessionId: 'a', origin: 'subagent' })
		]);
		// a runs → credits its ANCESTORS only (b, then the walk cuts at a);
		// a itself is never credited (self-running rides the `running` prop).
		expect(facts.runningDescendants.get('a')).toBeUndefined();
		expect(facts.runningDescendants.get('b')).toBe(1);
	});
});

describe('ghostRowsFor — the ghost set under open parents', () => {
	it('sub-agent under an open parent is a ghost; under closed parent is not', () => {
		const spine = [
			row('main'),
			row('kid', { parentSessionId: 'main', origin: 'subagent', running: true })
		];
		const facts = deriveLineage(spine);
		const ghosts = ghostRowsFor([panel('main')], spine, facts);
		expect(ghosts).toHaveLength(1);
		expect(ghosts[0]).toMatchObject({ sessionId: 'kid', parentSessionId: 'main', depth: 1, running: true });
		expect(ghostRowsFor([], spine, facts)).toHaveLength(0); // floor closed
	});

	it('an open child panel is NOT also a ghost (one session, one home)', () => {
		const spine = [row('main'), row('kid', { parentSessionId: 'main', origin: 'subagent' })];
		const facts = deriveLineage(spine);
		expect(ghostRowsFor([panel('main'), panel('kid')], spine, facts)).toHaveLength(0);
	});

	it('RECURSIVE (ADR depth amendment): opening only the ROOT surfaces the whole subtree as ghosts', () => {
		const spine = [
			row('main'),
			row('child', { parentSessionId: 'main', origin: 'subagent' }),
			row('grand', { parentSessionId: 'child', origin: 'subagent' })
		];
		const facts = deriveLineage(spine);
		// Only main is an open panel: child AND grand are both ghosts (the
		// grandchild nests under its ghost parent row), and BOTH leave the
		// spine (no double-listing for the whole subtree).
		const ghosts = ghostRowsFor([panel('main')], spine, facts);
		expect(ghosts.map((g) => [g.sessionId, g.depth])).toEqual([
			['child', 1],
			['grand', 2]
		]);
		expect(suppressFromSpine(spine, facts, new Set(['main'])).map((r) => r.sessionId)).toEqual(['main']);
	});

	it('grandchild ghost nests at depth 2 when its parent is an open panel', () => {
		const spine = [
			row('main'),
			row('child', { parentSessionId: 'main', origin: 'subagent' }),
			row('grand', { parentSessionId: 'child', origin: 'subagent' })
		];
		const facts = deriveLineage(spine);
		// child open as panel; grand is ghost under child (depth 2), main sees roll-up
		const ghosts = ghostRowsFor([panel('main'), panel('child')], spine, facts);
		expect(ghosts.map((g) => [g.sessionId, g.depth])).toEqual([['grand', 2]]);
	});

	it('zero panels open → empty ghost set (PRD §4.5 case 8)', () => {
		const spine = [row('main'), row('kid', { parentSessionId: 'main', origin: 'subagent' })];
		expect(ghostRowsFor([], spine, deriveLineage(spine))).toEqual([]);
	});
});

describe('suppressFromSpine — no double-listing', () => {
	it('sub-agent under an open parent is suppressed; plain rows and orphans stay', () => {
		const spine = [
			row('plain'),
			row('main'),
			row('kid', { parentSessionId: 'main', origin: 'subagent' }),
			row('orphan', { parentSessionId: 'gone', origin: 'subagent' })
		];
		const facts = deriveLineage(spine);
		const visible = suppressFromSpine(spine, facts, new Set(['main']));
		expect(visible.map((r) => r.sessionId)).toEqual(['plain', 'main', 'orphan']);
	});

	it('child panel open (real panel, not ghost) still suppressed from spine', () => {
		const spine = [row('main'), row('kid', { parentSessionId: 'main', origin: 'subagent' })];
		const facts = deriveLineage(spine);
		expect(suppressFromSpine(spine, facts, new Set(['main', 'kid'])).map((r) => r.sessionId)).toEqual(['main']);
	});
});

describe('insertionIndex — the Lineage Pin', () => {
	it('sub-agent splices at parentIndex + 1 — never appended past the family', () => {
		const spine = [
			row('s1'), row('main'), row('s3'), row('s4'),
			row('kid', { parentSessionId: 'main', origin: 'subagent' })
		];
		const facts = deriveLineage(spine);
		expect(insertionIndex([panel('s1'), panel('main'), panel('s3'), panel('s4')], 'kid', facts)).toBe(2);
	});

	it('plain session and orphan sub-agent append (root behavior)', () => {
		const spine = [row('s1'), row('orphan', { parentSessionId: 'gone', origin: 'subagent' })];
		const facts = deriveLineage(spine);
		const panels = [panel('s1')];
		expect(insertionIndex(panels, 's2', facts)).toBe(1);
		expect(insertionIndex(panels, 'orphan', facts)).toBe(1);
	});

	it('sub-agent whose parent is not on the floor appends (adoption path handles family)', () => {
		const spine = [row('main'), row('kid', { parentSessionId: 'main', origin: 'subagent' })];
		const facts = deriveLineage(spine);
		expect(insertionIndex([panel('s1')], 'kid', facts)).toBe(1);
	});
});

// W6 fix 1 + W6b (adopt order): the panel group's RENDER sequence — real
// child panels DIRECTLY below their spawner (ADR worked example), ghost
// clusters after real children, grandchild ghosts under their ghost
// parents. Before W6 depth-2 ghosts rendered nowhere (I4 violation);
// before W6b a parent's ghost siblings wedged between it and its adopted
// real child (live-reproduced 2026-08-27: adopted child rendered 4th of 4).
describe('familyRenderOrder — the interleaved family sequence', () => {
	const p = (id: string, parent: string | null) => ({ id, parent });
	const shape = (entries: ReturnType<typeof familyRenderOrder<{ id: string; parent: string | null }, { id: string; parent: string | null }>>) =>
		entries.map((e) => (e.kind === 'panel' ? `P:${e.member.id}` : `G:${e.member.id}@${e.anchor}`));

	it('adopted real child renders DIRECTLY below its spawner — ghost siblings after (the bug)', () => {
		const panels = [p('root', null), p('kid1', 'root')]; // floor: kid1 adopted at parentIndex+1
		const ghosts = [p('kid2', 'root'), p('kid3', 'root'), p('kid4', 'root')];
		expect(shape(familyRenderOrder(panels, ghosts))).toEqual([
			'P:root',
			'P:kid1', // directly below spawner — never below ghost siblings
			'G:kid2@root',
			'G:kid3@root',
			'G:kid4@root'
		]);
	});

	it('grandchild ghost nests under its ghost parent (I4); anchor is the panel ancestor', () => {
		const ghosts = [p('kid', 'root'), p('grand', 'kid')];
		expect(shape(familyRenderOrder([p('root', null)], ghosts))).toEqual([
			'P:root',
			'G:kid@root',
			'G:grand@root'
		]);
	});

	it('ghost under an adopted real child anchors to THAT child, not the root', () => {
		const panels = [p('root', null), p('mid', 'root')];
		const ghosts = [p('sib', 'root'), p('grand', 'mid')];
		expect(shape(familyRenderOrder(panels, ghosts))).toEqual([
			'P:root',
			'P:mid',
			'G:grand@mid',
			'G:sib@root'
		]);
	});

	it('orphan panel (parent holds no panel) heads its own block at its floor position', () => {
		const panels = [p('root', null), p('orphan', 'off-floor'), p('s2', null)];
		expect(shape(familyRenderOrder(panels, []))).toEqual(['P:root', 'P:orphan', 'P:s2']);
	});

	it('strangers between families stay at their floor positions (units render in floor order)', () => {
		const panels = [p('s1', null), p('root', null), p('kid', 'root'), p('s3', null)];
		expect(shape(familyRenderOrder(panels, []))).toEqual([
			'P:s1',
			'P:root',
			'P:kid',
			'P:s3'
		]);
	});

	it('cycles fail soft — every member renders exactly once', () => {
		const panels = [p('a', 'b'), p('b', 'a')];
		const ghosts = [p('g1', 'a'), p('g2', 'g1'), p('g2', 'g1')];
		const out = familyRenderOrder(panels, ghosts);
		const ids = out.map((e) => e.member.id);
		expect(new Set(ids).size).toBe(ids.length); // no duplicates
		expect(ids.sort()).toEqual(['a', 'b', 'g1', 'g2']);
	});
});

// W7 (2026-08-28): spine CONTIGUITY — the spine rendered feed order with an
// indent only, so a foreign root could wedge between a parent's indented
// children (live-caught: session-85d8e67c interleaved the 5-child family of
// session-2758c928 — "overlapping in between sub-agents is confusing").
// nestSpineFamilies reorders so every family is one contiguous block.
describe('nestSpineFamilies — spine contiguity (D6/I1)', () => {
	const ids = (rows: DsiSessionSummary[]) => rows.map((r) => r.sessionId);

	it('the live-caught shape: a foreign root never wedges inside a family block', () => {
		// Feed order = recency (updatedAt desc) from the live run, wedge and all.
		const spine = [
			row('parent'),
			row('kid5', { parentSessionId: 'parent', origin: 'subagent' }),
			row('kid4', { parentSessionId: 'parent', origin: 'subagent' }),
			row('kid3', { parentSessionId: 'parent', origin: 'subagent' }),
			row('kid2', { parentSessionId: 'parent', origin: 'subagent' }),
			row('stranger'), // ← the wedge: recency parked it between the children
			row('kid1', { parentSessionId: 'parent', origin: 'subagent' })
		];
		const nested = nestSpineFamilies(spine, deriveLineage(spine));
		expect(ids(nested)).toEqual(['parent', 'kid5', 'kid4', 'kid3', 'kid2', 'kid1', 'stranger']);
		// The contract, not just the example: the block [parent..kid1] is
		// contiguous — no stranger between any two family members (I1).
		const family = ['parent', 'kid1', 'kid2', 'kid3', 'kid4', 'kid5'];
		const positions = ids(nested).filter((id) => family.includes(id));
		expect(positions).toEqual(['parent', 'kid5', 'kid4', 'kid3', 'kid2', 'kid1']);
	});

	it('input order is authoritative for roots and siblings (flattenLineage pattern)', () => {
		const spine = [
			row('r1'),
			row('head-b'),
			row('b2', { parentSessionId: 'head-b', origin: 'subagent' }),
			row('r2'),
			row('head-a'),
			row('a1', { parentSessionId: 'head-a', origin: 'subagent' })
		];
		// Roots keep their relative order (r1, head-b, r2, head-a); siblings
		// keep theirs (b2 under head-b; a1 under head-a) — no re-sorting.
		expect(ids(nestSpineFamilies(spine, deriveLineage(spine)))).toEqual([
			'r1',
			'head-b',
			'b2',
			'r2',
			'head-a',
			'a1'
		]);
	});

	it('recursive: a grandchild nests under its nested parent, below the head', () => {
		const spine = [
			row('stranger'),
			row('head'),
			row('grand', { parentSessionId: 'kid', origin: 'subagent' }),
			row('kid', { parentSessionId: 'head', origin: 'subagent' })
		];
		expect(ids(nestSpineFamilies(spine, deriveLineage(spine)))).toEqual([
			'stranger',
			'head',
			'kid',
			'grand'
		]);
	});

	it('child whose head is absent from the rows degrades to its input position (I4)', () => {
		// Facts derive over the FULL feed (head known), but the render list
		// lost the head (current session, paneled, or filtered): the child
		// cannot nest under an invisible row — it stays where it ranked.
		const feed = [row('head'), row('kid', { parentSessionId: 'head', origin: 'subagent' })];
		const facts = deriveLineage(feed);
		const renderList = [row('stranger'), row('kid', { parentSessionId: 'head', origin: 'subagent' })];
		expect(ids(nestSpineFamilies(renderList, facts))).toEqual(['stranger', 'kid']);
	});

	it('a running child rides at its head ranked position (no family tearing)', () => {
		// rankRunningFirst floats the running kid to the top band; nesting
		// glues it back under its idle head — motion shows at the head's
		// position, the block never splits across the two bands.
		const spine = [
			row('r1'),
			row('kid', { parentSessionId: 'head', origin: 'subagent', running: true }),
			row('head')
		];
		const ranked = [...spine].sort((a, b) => Number(b.running) - Number(a.running));
		expect(ids(ranked)).toEqual(['kid', 'r1', 'head']); // the tearing nestSpineFamilies heals
		// kid glues under head (I2 — never above its spawner); r1 keeps its
		// ranked slot ahead of the whole block.
		expect(ids(nestSpineFamilies(ranked, deriveLineage(spine)))).toEqual(['r1', 'head', 'kid']);
	});

	it('cycles fail soft — members emit once, nothing dropped', () => {
		const spine = [
			row('stranger'),
			row('a', { parentSessionId: 'b', origin: 'subagent' }),
			row('b', { parentSessionId: 'a', origin: 'subagent' })
		];
		const nested = nestSpineFamilies(spine, deriveLineage(spine));
		expect(ids(nested)).toEqual(['stranger', 'a', 'b']);
		expect(new Set(ids(nested)).size).toBe(nested.length);
	});

	it('plain rows pass through untouched (no lineage, no reorder)', () => {
		const spine = [row('x'), row('y'), row('z')];
		expect(nestSpineFamilies(spine, deriveLineage(spine))).toEqual(spine);
	});
});

// The 2026-09-01 fork amendment: fork children (parentSessionId set,
// origin null) are FAMILY for layout — childrenByParent, depthById, spine
// nesting — while spawn semantics (ghosts, suppression, roll-up) stay
// origin-'subagent'. Live trigger: the session-35fe1249 family (one
// original + four forks), where fork rows carried depth 0 and root move
// semantics, so a sidebar move-up leapt a fork above its own parent while
// the render kept it grouped (the move/render split-brain).
describe('deriveLineage — fork lineage is family (2026-09-01)', () => {
	it('a fork child is indexed and depth-1 like a sub-agent, but never a spawn fact', () => {
		const facts = deriveLineage([row('main'), row('fork', { parentSessionId: 'main' })]);
		expect(facts.childrenByParent.get('main')?.map((r) => r.sessionId)).toEqual(['fork']);
		expect(facts.depthById.get('fork')).toBe(1);
		expect(facts.familyIds.has('fork')).toBe(true);
		expect(facts.subagentIds.has('fork')).toBe(false);
	});

	it('a running fork does NOT credit ancestors (the delegated badge stays spawn-only)', () => {
		const facts = deriveLineage([row('main'), row('fork', { parentSessionId: 'main', running: true })]);
		expect(facts.runningDescendants.get('main')).toBeUndefined();
	});

	it('mixed family: depth walks through the fork hop (root 0, fork 1, sub-agent 2)', () => {
		const facts = deriveLineage([
			row('main'),
			row('fork', { parentSessionId: 'main' }),
			row('spawned', { parentSessionId: 'fork', origin: 'subagent' })
		]);
		expect(facts.depthById.get('fork')).toBe(1);
		expect(facts.depthById.get('spawned')).toBe(2);
	});

	it('orphan fork degrades to root (I4)', () => {
		const facts = deriveLineage([row('fork', { parentSessionId: 'gone' })]);
		expect(facts.depthById.get('fork')).toBe(0);
		expect(facts.familyIds.has('fork')).toBe(false);
	});

	it('fork cycles fail soft (members emit as roots, nothing lost)', () => {
		const facts = deriveLineage([row('a', { parentSessionId: 'b' }), row('b', { parentSessionId: 'a' })]);
		expect(facts.depthById.get('a')).toBe(0);
		expect(facts.depthById.get('b')).toBe(0);
		expect(facts.familyIds.size).toBe(2);
	});
});

describe('ghosts and suppression stay spawn-only (the fork boundary)', () => {
	it('a closed fork under an open parent STAYS in the spine — the spine is its only home', () => {
		const spine = [row('main'), row('fork', { parentSessionId: 'main' })];
		const facts = deriveLineage(spine);
		expect(ghostRowsFor([panel('main')], spine, facts)).toEqual([]); // no ghost
		expect(suppressFromSpine(spine, facts, new Set(['main'])).map((r) => r.sessionId)).toEqual([
			'main',
			'fork'
		]);
	});

	it('an open fork is not a ghost either (one session, one home — panels own it)', () => {
		const spine = [row('main'), row('fork', { parentSessionId: 'main' })];
		const facts = deriveLineage(spine);
		expect(ghostRowsFor([panel('main'), panel('fork')], spine, facts)).toEqual([]);
	});

	it('a sub-agent under a CLOSED fork anchors no ghost through the fork hop', () => {
		// The ghost/suppression walk runs on SUB-AGENT edges only: a ghost
		// anchored to a closed fork (neither panel nor ghost) would emit
		// nowhere, and suppression would then erase it from the spine (I4).
		const spine = [
			row('main'),
			row('fork', { parentSessionId: 'main' }),
			row('spawned', { parentSessionId: 'fork', origin: 'subagent', running: true })
		];
		const facts = deriveLineage(spine);
		expect(ghostRowsFor([panel('main')], spine, facts)).toEqual([]);
		expect(suppressFromSpine(spine, facts, new Set(['main'])).map((r) => r.sessionId)).toEqual([
			'main',
			'fork',
			'spawned'
		]);
	});

	it('a sub-agent under an OPEN fork panel is a ghost at its true depth (2)', () => {
		const spine = [
			row('main'),
			row('fork', { parentSessionId: 'main' }),
			row('spawned', { parentSessionId: 'fork', origin: 'subagent', running: true })
		];
		const facts = deriveLineage(spine);
		const ghosts = ghostRowsFor([panel('main'), panel('fork')], spine, facts);
		expect(ghosts.map((g) => [g.sessionId, g.parentSessionId, g.depth])).toEqual([
			['spawned', 'fork', 2]
		]);
	});
});

describe('nestSpineFamilies — fork families nest (2026-09-01)', () => {
	const ids = (rows: DsiSessionSummary[]) => rows.map((r) => r.sessionId);

	it('fork children nest under their head like sub-agents', () => {
		const spine = [
			row('stranger'),
			row('main'),
			row('fork2', { parentSessionId: 'main' }),
			row('fork1', { parentSessionId: 'main' })
		];
		expect(ids(nestSpineFamilies(spine, deriveLineage(spine)))).toEqual([
			'stranger',
			'main',
			'fork2',
			'fork1'
		]);
	});

	it('mixed nesting recurses through the fork hop', () => {
		const spine = [
			row('main'),
			row('spawned', { parentSessionId: 'fork', origin: 'subagent' }),
			row('fork', { parentSessionId: 'main' })
		];
		expect(ids(nestSpineFamilies(spine, deriveLineage(spine)))).toEqual(['main', 'fork', 'spawned']);
	});

	it('a fork whose head is absent from the render list degrades to its input position (I4)', () => {
		const feed = [row('main'), row('fork', { parentSessionId: 'main' })];
		const facts = deriveLineage(feed);
		const renderList = [row('stranger'), row('fork', { parentSessionId: 'main' })];
		expect(ids(nestSpineFamilies(renderList, facts))).toEqual(['stranger', 'fork']);
	});
});
