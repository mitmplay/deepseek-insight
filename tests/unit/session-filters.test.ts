/**
 * Unit: session-filters — the pure picker logic (2026-08-23; hybrid
 * revision same day).
 *
 * Behavior under test: workspace pills derive EXISTENCE from session cwd
 * and STATUS from the registry (ghost = grey, path not registered),
 * preset options, cwd-based filtering, self-healing of persisted keys,
 * and the conversation-count toggle. The current-session exemption is a
 * CALLER contract; these tests exercise plain lists.
 */
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SESSION_FILTER,
	applySessionDateFilter,
	applySessionFilter,
	applySessionFilterFamily,
	applySessionNameFilter,
	collectSessionDates,
	effectiveSessionFilter,
	isBlankMode,
	isRegisteredWorkspace,
	presetOptions,
	rankRunningFirst,
	sessionActivityDate,
	workspaceDisplayLabel,
	workspaceOptions
} from '$lib/utils/session-filters';
import type { DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';

function row(over: Partial<DsiSessionSummary>): DsiSessionSummary {
	return {
		sessionId: 's',
		title: null,
		agentPreset: null,
		running: false,
		blank: false,
		updatedAt: 0,
		workspace: null,
		turns: null,
		...over
	};
}

function ws(over: Partial<DsiWorkspaceSummary>): DsiWorkspaceSummary {
	return { workspaceId: 'w', title: 't', path: '/t', sessionIds: [], ...over };
}

describe('workspaceDisplayLabel (the shared title-first derivation, Chip Menu ADR D5)', () => {
	it('a registered workspace renders its registry title — rows and pills read alike', () => {
		const registry = [ws({ workspaceId: 'w-h', title: 'Renamed Home', path: '/Users/x/harness' })];
		expect(workspaceDisplayLabel('/Users/x/harness', registry)).toBe('Renamed Home');
	});

	it('a ghost cwd keeps the basename (the registry no longer names it)', () => {
		const registry = [ws({ workspaceId: 'w-h', title: 'Renamed Home', path: '/Users/x/harness' })];
		expect(workspaceDisplayLabel('/Users/x/old', registry)).toBe('old');
	});

	it('a blank title falls back to the basename (never a blank chip)', () => {
		const registry = [ws({ workspaceId: 'w-blank', title: '   ', path: '/Users/x/blank' })];
		expect(workspaceDisplayLabel('/Users/x/blank', registry)).toBe('blank');
	});
});

describe('workspaceOptions (cwd ∪ registry, registry-annotated)', () => {
	it('derives one pill per distinct cwd, counted, A–Z, marked registered by path match', () => {
		const rows = [
			row({ sessionId: '1', workspace: '/tmp' }),
			row({ sessionId: '2', workspace: '/tmp' }),
			row({ sessionId: '3', workspace: '/Users/x/harness' })
		];
		const registry = [ws({ workspaceId: 'w-h', title: 'harness', path: '/Users/x/harness' })];
		expect(workspaceOptions(rows, registry)).toEqual([
			{
				key: '/Users/x/harness',
				label: 'harness',
				path: '/Users/x/harness',
				count: 1,
				registered: true
			},
			{ key: '/tmp', label: 'tmp', path: '/tmp', count: 2, registered: false }
		]);
	});

	it('a DELETED workspace stays filterable as a ghost (sessions still carry its cwd)', () => {
		// The reported bug's shape: registry emptied, agentic-ai sessions remain.
		// Ghosts stay pill-filterable (original functionality, reinstated
		// 2026-08-26); the [folder] toggle HIDES ghost pills only while active.
		const rows = [row({ sessionId: 'b', workspace: '/Users/wharsojo/agentic-ai' })];
		const pills = workspaceOptions(rows, []);
		expect(pills).toEqual([
			{
				key: '/Users/wharsojo/agentic-ai',
				label: 'agentic-ai',
				path: '/Users/wharsojo/agentic-ai',
				count: 1,
				registered: false
			}
		]);
	});

	it('a registry workspace with NO sessions renders selectable at count 0 (New-chat selection)', () => {
		// 2026-08-24: pills arm + New chat — a freshly adopted folder must
		// be selectable before any session exists in it.
		const registry = [ws({ workspaceId: 'w-new', title: 'new-project', path: '/Users/x/new-project' })];
		expect(workspaceOptions([], registry)).toEqual([
			{
				key: '/Users/x/new-project',
				label: 'new-project',
				path: '/Users/x/new-project',
				count: 0,
				registered: true
			}
		]);
	});

	it('sessions without a cwd and an empty registry contribute no pills', () => {
		expect(workspaceOptions([row({ sessionId: 'a', workspace: null })], [])).toEqual([]);
	});

	it('registered labels are TITLE-FIRST (Chip Menu ADR D5): rename shows, key never moves', () => {
		// A rename performed anywhere (DSH sidebar or the chip menu) rewrites
		// the registry title; the path — the filter KEY — is untouched.
		const rows = [row({ sessionId: '1', workspace: '/Users/x/harness' })];
		const registry = [ws({ workspaceId: 'w-h', title: 'Renamed Home', path: '/Users/x/harness' })];
		expect(workspaceOptions(rows, registry)).toEqual([
			{
				key: '/Users/x/harness',
				label: 'Renamed Home',
				path: '/Users/x/harness',
				count: 1,
				registered: true
			}
		]);
	});

	it('ghost and cwd-only keys keep the basename label (title map misses them)', () => {
		// Registry dropped the workspace after sessions ran there: hybrid
		// truth keeps the pill, the basename stays the label.
		const rows = [row({ sessionId: '1', workspace: '/Users/x/old' })];
		const registry = [ws({ workspaceId: 'w-h', title: 'Renamed Home', path: '/Users/x/harness' })];
		const pills = workspaceOptions(rows, registry);
		expect(pills.find((p) => p.key === '/Users/x/old')).toMatchObject({
			label: 'old',
			registered: false
		});
		// The registered entry still shows its title, never its basename.
		expect(pills.find((p) => p.key === '/Users/x/harness')).toMatchObject({
			label: 'Renamed Home',
			registered: true
		});
	});

	it('an empty-string registry title falls back to the basename (never a blank pill)', () => {
		const registry = [ws({ workspaceId: 'w-blank', title: '   ', path: '/Users/x/blank' })];
		expect(workspaceOptions([], registry)).toEqual([
			{
				key: '/Users/x/blank',
				label: 'blank',
				path: '/Users/x/blank',
				count: 0,
				registered: true
			}
		]);
	});
});

describe('isRegisteredWorkspace', () => {
	it('matches by path; null cwd and missing paths are ghosts', () => {
		const registry = [ws({ path: '/Users/x/harness' })];
		expect(isRegisteredWorkspace('/Users/x/harness', registry)).toBe(true);
		expect(isRegisteredWorkspace('/tmp', registry)).toBe(false);
		expect(isRegisteredWorkspace(null, registry)).toBe(false);
		expect(isRegisteredWorkspace('/tmp', [])).toBe(false);
	});
});

describe('effectiveSessionFilter (pill-key self-heal)', () => {
	it('keeps a key some pill carries', () => {
		const f = { ...DEFAULT_SESSION_FILTER, workspace: '/tmp' };
		expect(effectiveSessionFilter(f, ['/tmp'])).toBe(f);
	});

	it('keeps a ZERO-session registry key (legitimate New-chat selection)', () => {
		// 2026-08-24: a freshly adopted workspace has no rows yet; the
		// selection must survive the self-heal.
		const f = { ...DEFAULT_SESSION_FILTER, workspace: '/Users/x/new-project' };
		expect(effectiveSessionFilter(f, ['/Users/x/new-project'])).toBe(f);
	});

	it('reads a key no pill carries as unfiltered (never match-nothing)', () => {
		const f = { ...DEFAULT_SESSION_FILTER, workspace: '/gone' };
		expect(effectiveSessionFilter(f, [])).toEqual({ ...f, workspace: null });
	});
});

describe('presetOptions (host catalog ∪ session presets)', () => {
	it('lists EVERY available preset — count 0 for agents with no sessions yet', () => {
		// 2026-08-24: the pills arm + New chat with any host agent, used or
		// not; counts badge sessions A–Z.
		const available = [
			{ id: 'research', name: 'Research', description: null, isDefault: true },
			{ id: 'main', name: 'Main', description: null, isDefault: false }
		];
		const rows = [row({ sessionId: '1', agentPreset: 'main' })];
		expect(presetOptions(available, rows)).toEqual([
			{ key: 'main', label: 'Main', count: 1 },
			{ key: 'research', label: 'Research', count: 0 }
		]);
	});

	it('labels by host display name, falls back to id, orders A–Z by label', () => {
		// DSH picker parity: a preset.yml `name` shows as the label
		// (`cordis` → `Creator mode`); a host-listed preset with no name
		// keeps its id; ordering follows the LABEL (workspace-pill parity),
		// not the id.
		const available = [
			{ id: 'cordis', name: 'Creator mode', description: null, isDefault: false },
			{ id: 'zen', name: null, description: null, isDefault: false }
		];
		const rows = [row({ sessionId: '1', agentPreset: 'cordis' })];
		expect(presetOptions(available, rows)).toEqual([
			{ key: 'cordis', label: 'Creator mode', count: 1 },
			{ key: 'zen', label: 'zen', count: 0 }
		]);
	});

	it('a preset sessions carry that the host no longer lists stays filterable', () => {
		const rows = [row({ sessionId: '1', agentPreset: 'deleted-preset' })];
		expect(presetOptions([], rows)).toEqual([
			{ key: 'deleted-preset', label: 'deleted-preset', count: 1 }
		]);
	});

	it('an empty catalog over preset-less rows yields nothing; null preset never counts', () => {
		expect(presetOptions([], [row({ sessionId: 'a', agentPreset: null })])).toEqual([]);
	});
});

describe('applySessionFilter', () => {
	const rows = [
		row({ sessionId: 'a', workspace: '/tmp', agentPreset: 'main', blank: false }),
		row({ sessionId: 'b', workspace: '/Users/x/harness', agentPreset: 'app-dev', blank: true }),
		row({ sessionId: 'c', workspace: '/Users/x/harness', agentPreset: 'main', blank: false })
	];

	it('default filter ([!0]) hides blank, keeps everything else', () => {
		expect(DEFAULT_SESSION_FILTER.blankMode).toBe('nonempty');
		expect(
			applySessionFilter(rows, DEFAULT_SESSION_FILTER).map((r) => r.sessionId)
		).toEqual(['a', 'c']);
	});

	it("'any' (none selected) keeps blank rows — no filtering", () => {
		const out = applySessionFilter(rows, { ...DEFAULT_SESSION_FILTER, blankMode: 'any' });
		expect(out.map((r) => r.sessionId)).toEqual(['a', 'b', 'c']);
	});

	it("'empty' ([0]) keeps ONLY blank rows", () => {
		const out = applySessionFilter(rows, { ...DEFAULT_SESSION_FILTER, blankMode: 'empty' });
		expect(out.map((r) => r.sessionId)).toEqual(['b']);
	});

	it('workspace pill matches by cwd equality — ghost or not', () => {
		const out = applySessionFilter(rows, {
			...DEFAULT_SESSION_FILTER,
			workspace: '/Users/x/harness'
		});
		expect(out.map((r) => r.sessionId)).toEqual(['c']);
	});

	it('preset pill narrows to one preset', () => {
		const out = applySessionFilter(rows, { ...DEFAULT_SESSION_FILTER, preset: 'main' });
		expect(out.map((r) => r.sessionId)).toEqual(['a', 'c']);
	});

	it('pills compose (AND)', () => {
		const out = applySessionFilter(rows, {
			...DEFAULT_SESSION_FILTER,
			workspace: '/Users/x/harness',
			preset: 'main'
		});
		expect(out.map((r) => r.sessionId)).toEqual(['c']);
	});

	it('blank mode composes with a workspace filter', () => {
		const out = applySessionFilter(rows, {
			...DEFAULT_SESSION_FILTER,
			workspace: '/Users/x/harness',
			blankMode: 'empty'
		});
		expect(out.map((r) => r.sessionId)).toEqual(['b']);
	});

	it('no match yields an empty list', () => {
		const out = applySessionFilter(rows, { ...DEFAULT_SESSION_FILTER, preset: 'standard' });
		expect(out).toEqual([]);
	});

	// ── 'workspace' segment (2026-08-26): registered-cwd membership ────
	// Registry truth: harness is registered, /tmp is a ghost.
	const registry = [ws({ workspaceId: 'h', path: '/Users/x/harness' })];

	it("'workspace' ([folder]) keeps ONLY rows whose cwd is registered", () => {
		// blank is IRRELEVANT in workspace mode — the registered blank row
		// 'b' survives (predicate must not AND with the blank clause).
		const out = applySessionFilter(rows, { ...DEFAULT_SESSION_FILTER, blankMode: 'workspace' }, registry);
		expect(out.map((r) => r.sessionId)).toEqual(['b', 'c']);
	});

	it("'workspace' drops ghost cwds and cwd-less rows", () => {
		const withBare = [...rows, row({ sessionId: 'bare', workspace: null })];
		const out = applySessionFilter(
			withBare,
			{ ...DEFAULT_SESSION_FILTER, blankMode: 'workspace' },
			registry
		);
		expect(out.map((r) => r.sessionId)).toEqual(['b', 'c']); // no 'a' (ghost /tmp), no 'bare'
	});

	it("'workspace' composes with pills (AND) — preset narrows inside registered", () => {
		const out = applySessionFilter(
			rows,
			{ ...DEFAULT_SESSION_FILTER, blankMode: 'workspace', preset: 'app-dev' },
			registry
		);
		expect(out.map((r) => r.sessionId)).toEqual(['b']);
	});

	it("'workspace' with an empty registry keeps nothing (honest, not all)", () => {
		const out = applySessionFilter(rows, { ...DEFAULT_SESSION_FILTER, blankMode: 'workspace' }, []);
		expect(out).toEqual([]);
	});

	it("isBlankMode accepts 'workspace' (persistence boundary)", () => {
		expect(isBlankMode('workspace')).toBe(true);
		expect(isBlankMode('everything')).toBe(false);
	});
});

describe('rankRunningFirst (running on top, 2026-08-26)', () => {
	it('floats running rows above idle rows, preserving host order within each band', () => {
		// Host recency order: run-new (newest) … idle-old (oldest). The
		// ranking splits the list into two bands — running first — and
		// NEVER reorders inside a band.
		const rows = [
			row({ sessionId: 'idle-old' }),
			row({ sessionId: 'run-new', running: true }),
			row({ sessionId: 'idle-new' }),
			row({ sessionId: 'run-old', running: true })
		];
		expect(rankRunningFirst(rows).map((r) => r.sessionId)).toEqual([
			'run-new',
			'run-old',
			'idle-old',
			'idle-new'
		]);
	});

	it('does not mutate the caller’s list', () => {
		const rows = [row({ sessionId: 'a' }), row({ sessionId: 'b', running: true })];
		const snapshot = rows.map((r) => r.sessionId);
		rankRunningFirst(rows);
		expect(rows.map((r) => r.sessionId)).toEqual(snapshot);
	});

	it('single-band lists (all idle, all running, empty) pass through in order', () => {
		const idle = [row({ sessionId: 'a' }), row({ sessionId: 'b' })];
		expect(rankRunningFirst(idle).map((r) => r.sessionId)).toEqual(['a', 'b']);
		const run = [row({ sessionId: 'a', running: true }), row({ sessionId: 'b', running: true })];
		expect(rankRunningFirst(run).map((r) => r.sessionId)).toEqual(['a', 'b']);
		expect(rankRunningFirst([])).toEqual([]);
	});
});

// ── Family filter (2026-08-27 lineage sidebar, task 1.4-T — ADR D7) ────
// Children ride the family head's visibility across every dimension; a
// child never appears alone in a list its head was filtered out of.
describe('applySessionFilterFamily — children ride the family head', () => {
	const main = row({ sessionId: 'main', workspace: '/w/one', agentPreset: 'scout', blank: false });
	const kid = row({
		sessionId: 'kid',
		parentSessionId: 'main',
		origin: 'subagent',
		workspace: '/w/two', // different cwd than its head
		agentPreset: 'other', // different preset
		blank: true
	});
	const grandkid = row({
		sessionId: 'grand',
		parentSessionId: 'kid',
		origin: 'subagent',
		workspace: '/w/three'
	});
	const family = [main, kid, grandkid];

	it('workspace filter matching only the HEAD keeps the whole family', () => {
		const out = applySessionFilterFamily(family, { workspace: '/w/one', preset: null, blankMode: 'any' });
		expect(out.map((s) => s.sessionId)).toEqual(['main', 'kid', 'grand']);
	});

	it('workspace filter NOT matching the head hides the whole family — no lone child', () => {
		const out = applySessionFilterFamily(family, { workspace: '/w/two', preset: null, blankMode: 'any' });
		expect(out).toEqual([]); // kid's own cwd matching does NOT surface it alone
	});

	it('preset + blank dimensions also ride the head', () => {
		const preset = applySessionFilterFamily(family, { workspace: null, preset: 'scout', blankMode: 'any' });
		expect(preset.map((s) => s.sessionId)).toEqual(['main', 'kid', 'grand']);
		const blankHead = applySessionFilterFamily(family, { workspace: null, preset: null, blankMode: 'empty' });
		expect(blankHead).toEqual([]); // [0] keeps blank only; non-blank head hidden → kids ride
	});

	it('default [!0] keeps the family together — kid own blank flag is irrelevant', () => {
		const out = applySessionFilterFamily(family, DEFAULT_SESSION_FILTER, []);
		expect(out.map((s) => s.sessionId)).toEqual(['main', 'kid', 'grand']); // 3: kids ride the non-blank head
	});

	it('orphan sub-agent evaluates on itself (I4 root behavior)', () => {
		const orphan = row({ sessionId: 'orphan', parentSessionId: 'gone', origin: 'subagent', workspace: '/w/two', blank: false });
		const out = applySessionFilterFamily([main, orphan], { workspace: '/w/two', preset: null, blankMode: 'any' });
		expect(out.map((s) => s.sessionId)).toEqual(['orphan']); // its own cwd decides
	});

	it('cycle in lineage is cut safely (family still filters, never loops)', () => {
		const a = row({ sessionId: 'a', parentSessionId: 'b', origin: 'subagent', workspace: '/w/one' });
		const b = row({ sessionId: 'b', parentSessionId: 'a', origin: 'subagent', workspace: '/w/two' });
		const out = applySessionFilterFamily([a, b], { workspace: '/w/one', preset: null, blankMode: 'any' });
		// head-walk cuts AT the revisited node: a reaches b (judges by /w/two →
		// hidden), b reaches a (judges by /w/one → kept). Deterministic, no loop.
		expect(out.map((s) => s.sessionId)).toEqual(['b']);
	});
});

// ── Name filter (2026-09-01 spine group header — family-aware, D7) ─────
// The header input keeps the rows whose display label (title ?? 'untitled')
// matches, and renders each match's whole FAMILY: a head match keeps its
// sub-agent children nested, a child match keeps its head. Ordering,
// blank modes, and pills stay downstream — this decides membership only.
describe('applySessionNameFilter — the spine header query', () => {
	const head = row({ sessionId: 'main', title: 'Refactor DSI sidebar' });
	const kid = row({ sessionId: 'kid', title: 's.agent 1', parentSessionId: 'main', origin: 'subagent' });
	const grand = row({
		sessionId: 'grand',
		title: 's.agent 2',
		parentSessionId: 'kid',
		origin: 'subagent'
	});
	const other = row({ sessionId: 'other', title: 'Load project folders' });
	const blank = row({ sessionId: 'blank', title: null, blank: true });
	const family = [head, kid, grand, other, blank];

	it('empty and whitespace-only queries return the input unchanged', () => {
		expect(applySessionNameFilter(family, '')).toBe(family);
		expect(applySessionNameFilter(family, '   ')).toBe(family);
	});

	it('case-insensitive substring match on the display label', () => {
		expect(applySessionNameFilter(family, 'REFACTOR').map((s) => s.sessionId)).toEqual([
			'main',
			'kid',
			'grand'
		]);
	});

	it('a query with no match anywhere removes the whole family', () => {
		expect(applySessionNameFilter([head, kid, grand], 'zzz-nothing')).toEqual([]);
	});

	it('matching a sub-agent keeps its head AND the rest of the family (D7)', () => {
		expect(applySessionNameFilter(family, 's.agent 2').map((s) => s.sessionId)).toEqual([
			'main',
			'kid',
			'grand'
		]);
	});

	it('a head match carries its descendants; a sibling root matching only itself stays alone', () => {
		const out = applySessionNameFilter(family, 'load project');
		expect(out.map((s) => s.sessionId)).toEqual(['other']);
	});

	it("'untitled' matches title-less rows (the rendered label grammar)", () => {
		expect(applySessionNameFilter([blank, head], 'untitled').map((s) => s.sessionId)).toEqual([
			'blank'
		]);
	});

	it('an orphan sub-agent (parent absent) evaluates on itself — never dropped (I4)', () => {
		const orphan = row({
			sessionId: 'orphan',
			title: 'lost child',
			parentSessionId: 'gone',
			origin: 'subagent'
		});
		expect(applySessionNameFilter([orphan, head], 'lost').map((s) => s.sessionId)).toEqual([
			'orphan'
		]);
		expect(applySessionNameFilter([orphan, head], 'refactor').map((s) => s.sessionId)).toEqual([
			'main'
		]);
	});

	it('a fork child (parentSessionId without origin subagent) nests like family (2026-09-01)', () => {
		const fork = row({ sessionId: 'fork', title: 'fork child', parentSessionId: 'main' });
		// A fork-child match keeps its head (the family promotion D7 grants
		// sub-agents) — the fork amendment made the edges kind-blind.
		expect(applySessionNameFilter([head, kid, grand, fork], 'fork child').map((s) => s.sessionId)).toEqual([
			'main',
			'kid',
			'grand',
			'fork'
		]);
		// A head match carries the fork child along, like any descendant.
		expect(applySessionNameFilter([head, kid, grand, fork], 'refactor').map((s) => s.sessionId)).toEqual([
			'main',
			'kid',
			'grand',
			'fork'
		]);
	});

	it('cycle members are cut safely and evaluated on themselves', () => {
		const a = row({ sessionId: 'a', title: 'alpha', parentSessionId: 'b', origin: 'subagent' });
		const b = row({ sessionId: 'b', title: 'bravo', parentSessionId: 'a', origin: 'subagent' });
		expect(applySessionNameFilter([a, b], 'alpha').map((s) => s.sessionId)).toEqual(['a']);
		expect(applySessionNameFilter([a, b], 'bravo').map((s) => s.sessionId)).toEqual(['b']);
	});

	it('input order survives (filter contract — ordering stays downstream)', () => {
		const out = applySessionNameFilter([other, head, kid, grand], 'refactor');
		expect(out.map((s) => s.sessionId)).toEqual(['main', 'kid', 'grand']);
	});
});

describe('sessionActivityDate + collectSessionDates (the calendar dot set)', () => {
	it('maps an epoch stamp to the LOCAL calendar day, padded', () => {
		// 2026-09-04 06:00 UTC == 2026-09-03 23:00 in UTC-7 — the date is the
		// viewer's local day, not the timestamp's UTC day.
		const ts = new Date(2026, 8, 4, 12, 30).getTime(); // local 2026-09-04 12:30
		expect(sessionActivityDate(ts)).toBe('2026-09-04');
		expect(sessionActivityDate(new Date(2026, 0, 5).getTime())).toBe('2026-01-05');
	});

	it('collects the distinct session days into a Set', () => {
		const rows = [
			row({ sessionId: '1', updatedAt: new Date(2026, 8, 3, 9).getTime() }),
			row({ sessionId: '2', updatedAt: new Date(2026, 8, 3, 18).getTime() }),
			row({ sessionId: '3', updatedAt: new Date(2026, 8, 4, 9).getTime() })
		];
		expect(collectSessionDates(rows)).toEqual(new Set(['2026-09-03', '2026-09-04']));
		expect(collectSessionDates([])).toEqual(new Set());
	});
});

describe('applySessionDateFilter (the spine date stage, 2026-09-04)', () => {
	const dayA = new Date(2026, 8, 3, 10).getTime();
	const dayB = new Date(2026, 8, 4, 10).getTime();

	it("'' is a pass-through — the unfiltered contract", () => {
		const rows = [row({ sessionId: '1', updatedAt: dayA }), row({ sessionId: '2', updatedAt: dayB })];
		expect(applySessionDateFilter(rows, '')).toBe(rows);
	});

	it('keeps only rows last active on the picked day', () => {
		const rows = [
			row({ sessionId: 'mon', updatedAt: dayA }),
			row({ sessionId: 'tue', updatedAt: dayB }),
			row({ sessionId: 'mon-2', updatedAt: dayA })
		];
		expect(applySessionDateFilter(rows, '2026-09-03').map((s) => s.sessionId)).toEqual(['mon', 'mon-2']);
		expect(applySessionDateFilter(rows, '2026-09-04').map((s) => s.sessionId)).toEqual(['tue']);
		expect(applySessionDateFilter(rows, '2026-01-01')).toEqual([]);
	});

	it('a matched head carries its family — children on other days ride along', () => {
		const head = row({ sessionId: 'main', title: 'refactor the parser', updatedAt: dayA });
		const kid = row({ sessionId: 'kid', title: 'sub', parentSessionId: 'main', origin: 'subagent', updatedAt: dayB });
		const other = row({ sessionId: 'other', title: 'unrelated', updatedAt: dayB });
		const out = applySessionDateFilter([head, kid, other], '2026-09-03');
		expect(out.map((s) => s.sessionId)).toEqual(['main', 'kid']);
	});

	it('a matched child promotes its head (the family grammar, date-blind)', () => {
		const head = row({ sessionId: 'main', title: 'refactor the parser', updatedAt: dayB });
		const kid = row({ sessionId: 'kid', title: 'sub', parentSessionId: 'main', origin: 'subagent', updatedAt: dayA });
		const out = applySessionDateFilter([head, kid], '2026-09-03');
		expect(out.map((s) => s.sessionId)).toEqual(['main', 'kid']);
	});

	it('input order survives (ordering stays downstream)', () => {
		const rows = [
			row({ sessionId: 'late', updatedAt: dayA }),
			row({ sessionId: 'early', updatedAt: dayA })
		];
		expect(applySessionDateFilter(rows, '2026-09-03').map((s) => s.sessionId)).toEqual(['late', 'early']);
	});
});
