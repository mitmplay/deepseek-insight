/**
 * Session filters — pure derivation + filtering for session pickers
 * (sidebar body and home list), 2026-08-23.
 *
 * DSH's model is FLAT: one host, many sessions, each carrying two orthogonal
 * attributes — workspace (the row's cwd) and agentPreset. Neither is a
 * container (a preset is a stateless composition; a workspace is a path many
 * sessions share), so pickers stay a flat recency-ordered list and these
 * helpers turn the attributes into CUES (row chips) and FILTERS (pills) —
 * never a navigation tree.
 *
 * Pills are ALSO the selection surface for New chat (2026-08-24): the
 * agent pills list EVERY preset the host offers (agentPreset.list — count 0
 * for agents without sessions yet) and the workspace pills include EVERY
 * registry workspace (a freshly adopted folder is selectable immediately).
 * Selecting a 0-count pill filters the list to nothing — that is honest —
 * and arms + New chat with that agent/workspace.
 *
 * Hybrid workspace truth (2026-08-23 revision): EXISTENCE derives from
 * session.cwd (every path sessions actually ran in stays filterable, even
 * when the host workspace registry no longer lists it); STATUS derives from
 * the registry (workspace.list). A cwd no registry entry matches is a GHOST
 * — rendered grey in pills and chips — meaning "these sessions used a
 * workspace that is no longer registered". The registry annotates; it never
 * removes the dimension. The SessionFilter [folder] toggle (2026-08-26)
 * complements this as a registered-ONLY view; it never replaces the
 * per-cwd pills — ghosts stay pill-filterable.
 *
 * The CURRENT session is exempt from filtering by design: where you already
 * are is never noise. Callers render it separately; `applySessionFilter`
 * receives the list without it.
 */

import type { DsiPreset, DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';

/** One filterable dimension value with its row count. */
export interface FilterOption {
	/** Match key (full cwd path / preset id). */
	key: string;
	/** Display label (workspace basename / preset display name — host `name`, else id). */
	label: string;
	/** Full cwd path — the workspace pill's tooltip; absent for presets. */
	path?: string;
	count: number;
	/** Workspace pills only: true when a registry entry carries this path. */
	registered?: boolean;
}

/** Conversation-count dimension — the `[0] | [!0] | [ws]` segmented
 *  toggle (quad-state since 2026-08-26; tri-state 2026-08-23). The
 *  buttons are mutually exclusive; tapping the selected one unselects
 *  it (back to 'any' = no filtering).
 *  - 'any'      — none selected, no blank/workspace filtering
 *  - 'empty'    — [0]: only never-prompted sessions
 *  - 'nonempty' — [!0]: only sessions with at least one conversation
 *  - 'workspace'— [folder]: only sessions whose cwd is a REGISTERED
 *                 (enabled) workspace in the host registry — ghost
 *                 cwds and cwd-less rows drop out */
export type BlankMode = 'any' | 'empty' | 'nonempty' | 'workspace';

/** Runtime guard for a stored BlankMode (persistence boundary). */
export function isBlankMode(v: unknown): v is BlankMode {
	return v === 'any' || v === 'empty' || v === 'nonempty' || v === 'workspace';
}

export interface SessionFilterState {
	/** Active workspace key (full cwd path), null = All. */
	workspace: string | null;
	/** Active preset id, null = All. */
	preset: string | null;
	/** Conversation-count toggle state (see BlankMode). */
	blankMode: BlankMode;
}

/** Default filter — [!0] selected (blank noise hidden), workspace/preset
 *  unfiltered. The hidden-blanks default predates the tri-state and stays;
 *  the difference is it is now a VISIBLE selection, not an invisible one. */
export const DEFAULT_SESSION_FILTER: SessionFilterState = {
	workspace: null,
	preset: null,
	blankMode: 'nonempty'
};

/**
 * Workspace display label — the path's basename (`/Users/x/dsh` → `dsh`).
 * @param cwd full workspace path.
 * @returns basename; `/` for the filesystem root; `?` for empty input.
 */
export function workspaceLabel(cwd: string | null): string {
	if (!cwd) return '?';
	if (cwd === '/') return '/';
	const base = cwd.split('/').filter(Boolean).at(-1);
	return base ?? '/';
}

/**
 * Workspace display label with the registry title honored (Chip Menu ADR
 * D5, 2026-09-05): a registered workspace renders its registry title — a
 * rename must be visible on EVERY surface that names the workspace, rows
 * and pills alike. Ghost cwds (the registry dropped the path) and
 * title-less entries keep the basename fallback — the hybrid truth's
 * split: the registry annotates, sessions' cwds persist.
 * @param cwd full workspace path (a session's cwd).
 * @param workspaces host workspace registry.
 * @returns registry title when present and non-blank, else the basename.
 */
export function workspaceDisplayLabel(cwd: string, workspaces: DsiWorkspaceSummary[]): string {
	const title = workspaces.find((w) => w.path === cwd)?.title;
	return title !== undefined && title.trim().length > 0 ? title : workspaceLabel(cwd);
}

/**
 * Ghost check (hybrid truth): a session cwd is REGISTERED when a registry
 * entry carries the same path. Unregistered = grey cue — the sessions ran
 * in that folder, but the host's workspace list no longer names it.
 */
export function isRegisteredWorkspace(
	cwd: string | null,
	workspaces: DsiWorkspaceSummary[]
): boolean {
	if (!cwd) return false;
	return workspaces.some((w) => w.path === cwd);
}

/**
 * Workspace pills — the SELECTION surface for New chat as much as a
 * filter (2026-08-24): one pill per distinct session cwd (hybrid
 * existence — ghost cwds included, grey) PLUS every registry workspace
 * (a freshly adopted folder with no sessions yet is selectable
 * immediately, count 0). Registry membership annotates status
 * (`registered` drives the grey ghost styling). A–Z by label;
 * the count is the badge, never the sort key.
 *
 * Labels are TITLE-FIRST for registered workspaces (Chip Menu ADR D5,
 * 2026-09-05): rename changes the registry title, never the path, so a
 * basename-only label would render a successful rename invisible. Ghost
 * and cwd-only keys keep the basename fallback — the hybrid truth's
 * split: the registry annotates, sessions' cwds persist.
 */
export function workspaceOptions(
	sessions: DsiSessionSummary[],
	workspaces: DsiWorkspaceSummary[]
): FilterOption[] {
	const counts = new Map<string, number>();
	for (const s of sessions) {
		if (!s.workspace) continue;
		counts.set(s.workspace, (counts.get(s.workspace) ?? 0) + 1);
	}
	const keys = new Set<string>([...counts.keys(), ...workspaces.map((w) => w.path)]);
	return [...keys]
		.map((key) => ({
			key,
			label: workspaceDisplayLabel(key, workspaces),
			path: key,
			count: counts.get(key) ?? 0,
			registered: isRegisteredWorkspace(key, workspaces)
		}))
		.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

/**
 * Validate a filter against the picker's own pills: a persisted workspace
 * key no pill carries anymore (sessions gone AND the registry dropped it)
 * reads as unfiltered — never as match-nothing. Keys with zero sessions
 * stay legitimate (the New-chat selection contract). Parents persist the
 * effective value so storage self-heals.
 */
export function effectiveSessionFilter(
	filter: SessionFilterState,
	workspaceKeys: string[]
): SessionFilterState {
	if (filter.workspace === null) return filter;
	return workspaceKeys.includes(filter.workspace) ? filter : { ...filter, workspace: null };
}

/**
 * Agent pills — EVERY preset the host offers (agentPreset.list) with
 * session counts, plus any preset sessions carry that the host no longer
 * lists (a deleted preset stays filterable for its rows). Count 0 agents
 * render selectable: the pill group is how the user ARMS + New chat with
 * an agent, whether or not one of its sessions exists yet. The label is
 * the host's display name when it carries one (DSH picker parity: a
 * preset.yml `name: Creator mode` shows as such, never the raw id);
 * presets the host no longer lists keep the id as their label. A–Z by
 * label, id tiebreak.
 */
export function presetOptions(
	available: DsiPreset[],
	sessions: DsiSessionSummary[]
): FilterOption[] {
	const counts = new Map<string, number>();
	for (const s of sessions) {
		if (!s.agentPreset) continue;
		counts.set(s.agentPreset, (counts.get(s.agentPreset) ?? 0) + 1);
	}
	const names = new Map<string, string>();
	for (const p of available) {
		if (p.name) names.set(p.id, p.name);
	}
	const keys = new Set<string>([...available.map((p) => p.id), ...counts.keys()]);
	return [...keys]
		.map((key) => ({ key, label: names.get(key) ?? key, count: counts.get(key) ?? 0 }))
		.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

/**
 * Apply the picker filter to a session list.
 * @param sessions rows to filter (callers pass the list WITHOUT the current
 *   session — it is exempt by design and rendered separately).
 * @param filter active pill/toggle state.
 * @param workspaces host workspace registry — the truth for the
 *   'workspace' toggle mode (registered = enabled). Callers all hold it;
 *   the default only keeps the signature backward-safe.
 * @returns rows matching workspace pill (cwd equality), preset pill, and
 *   the segmented toggle ('any' keeps everything; 'empty' keeps only
 *   blank rows; 'nonempty' keeps only non-blank rows; 'workspace' keeps
 *   only rows whose cwd is registered in the host registry).
 */
export function applySessionFilter(
	sessions: DsiSessionSummary[],
	filter: SessionFilterState,
	workspaces: DsiWorkspaceSummary[] = []
): DsiSessionSummary[] {
	return sessions.filter(
		(s) =>
			(filter.workspace === null || s.workspace === filter.workspace) &&
			(filter.preset === null || s.agentPreset === filter.preset) &&
			(filter.blankMode === 'any' ||
				filter.blankMode === 'workspace' ||
				(filter.blankMode === 'empty') === s.blank) &&
			(filter.blankMode !== 'workspace' || isRegisteredWorkspace(s.workspace, workspaces))
	);
}

/**
 * Family-aware variant (lineage sidebar task 1.4, ADR D7): predicates
 * evaluate on the FAMILY HEAD — a sub-agent rides its root ancestor's
 * visibility across every dimension, so a child never appears alone in a
 * filtered list its head was filtered out of. The filter answers "which
 * CONVERSATIONS do I want", and a spawned session is part of its spawner's
 * conversation, not a new one.
 *
 * Ancestry walks parentSessionId within the given list (cycle-safe);
 * an orphan sub-agent (head absent) evaluates on itself — root behavior,
 * never dropped (I4). Wired into the surfaces by task 4.2; applySessionFilter
 * itself stays untouched for non-family callers.
 */
export function applySessionFilterFamily(
	sessions: DsiSessionSummary[],
	filter: SessionFilterState,
	workspaces: DsiWorkspaceSummary[] = []
): DsiSessionSummary[] {
	const byId = new Map(sessions.map((s) => [s.sessionId, s] as const));
	const rootCache = new Map<string, DsiSessionSummary>();
	const headOf = (s: DsiSessionSummary): DsiSessionSummary => {
		const cached = rootCache.get(s.sessionId);
		if (cached !== undefined) return cached;
		const chain = new Set<string>([s.sessionId]);
		let current = s;
		for (;;) {
			const parent = current.parentSessionId ?? null;
			if (parent === null || chain.has(parent)) break; // root or cycle cut
			const parentRow = byId.get(parent);
			if (parentRow === undefined) break; // orphan: evaluates on itself
			chain.add(parent);
			current = parentRow;
		}
		rootCache.set(s.sessionId, current);
		return current;
	};
	return sessions.filter((s) => {
		const judge = headOf(s);
		return (
			(filter.workspace === null || judge.workspace === filter.workspace) &&
			(filter.preset === null || judge.agentPreset === filter.preset) &&
			(filter.blankMode === 'any' ||
				filter.blankMode === 'workspace' ||
				(filter.blankMode === 'empty') === judge.blank) &&
			(filter.blankMode !== 'workspace' || isRegisteredWorkspace(judge.workspace, workspaces))
		);
	});
}

/**
 * Family-aware name filter (the sidebar spine's header input, 2026-09-01):
 * keep the rows whose DISPLAY label matches the query — the exact string
 * the row renders (`title ?? 'untitled'`, RowSessionItem's grammar),
 * case-insensitive substring — and render each matching row's whole
 * FAMILY. D7's rule applied to search: a spawned session is part of its
 * spawner's conversation, so a head match keeps its sub-agent children
 * nested and a child match keeps its head (the child never orphans at
 * root level). An empty or whitespace-only query returns the input
 * unchanged (no filtering).
 *
 * Family edges mirror nestSpineFamilies: every row with a parent edge
 * whose parent is PRESENT in the list nests under it — sub-agents AND
 * fork children (the 2026-09-01 fork amendment; the panel group renders
 * by the same raw edges). An orphan (parent absent) evaluates on itself —
 * root behavior, never dropped (I4) — and cycle members fail soft the
 * same way. Survivors keep input order; ordering stays downstream
 * (rankRunningFirst, nestSpineFamilies).
 *
 * @param sessions rows to filter (the caller's spine candidates).
 * @param query the header input's raw text.
 * @returns the surviving rows in input order.
 */
export function applySessionNameFilter(
	sessions: DsiSessionSummary[],
	query: string
): DsiSessionSummary[] {
	const needle = query.trim().toLowerCase();
	if (needle === '') return sessions;
	return familySurvivalFilter(
		sessions,
		(s) => (s.title ?? 'untitled').toLowerCase().includes(needle)
	);
}

// ── Date filter (2026-09-04, the OCI FilterDateButton port) ────────────────

/**
 * Local-calendar `YYYY-MM-DD` of an epoch-ms timestamp — the spine's date
 * grammar. `updatedAt` is the only recency fact a session row carries, so
 * "on this date" means "last active on this local calendar day".
 * @param updatedAt epoch milliseconds (the host row's recency stamp).
 * @returns the local date string the calendar grid keys by.
 */
export function sessionActivityDate(updatedAt: number): string {
	const d = new Date(updatedAt);
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Dates holding at least one session — the calendar's dot set.
 * @param sessions rows to scan (the caller's spine candidates).
 * @returns a fresh `Set` of `YYYY-MM-DD` strings; empty input → empty set.
 */
export function collectSessionDates(sessions: DsiSessionSummary[]): Set<string> {
	const dates = new Set<string>();
	for (const s of sessions) dates.add(sessionActivityDate(s.updatedAt));
	return dates;
}

/**
 * Date filter (2026-09-04): keep rows whose last-activity LOCAL date is the
 * picked day. Families survive WHOLE — applySessionNameFilter's grammar, so
 * a parent picked for its own activity keeps its children (a sub-agent's
 * run on another day must not orphan itself from the head the spine nests
 * it under). Survivors keep input order; ordering stays downstream.
 * @param sessions rows to filter (the caller's spine candidates).
 * @param date the picked `YYYY-MM-DD`; `''` = unfiltered (pass-through).
 * @returns the surviving rows in input order.
 */
export function applySessionDateFilter(
	sessions: DsiSessionSummary[],
	date: string
): DsiSessionSummary[] {
	if (date === '') return sessions;
	return familySurvivalFilter(sessions, (s) => sessionActivityDate(s.updatedAt) === date);
}

/**
 * The name filter's family-survival walk, extracted 2026-09-04 for the
 * date filter: keep a root when its subtree holds ANY match, and mark
 * every member of a surviving family. Children index (nestSpineFamilies'
 * rule): every parent-present edge over the CANDIDATE rows — sub-agents
 * and forks alike; everything else (plain rows, orphans) is its own root
 * here. Two passes so survivors keep input order: (1) does a root's
 * subtree hold any match; (2) mark every member of a surviving family.
 * Cycle-safe: `seenLocal` cuts pass 1's walk, `keep.has` cuts pass 2's.
 * Cycle members (unreachable from any root) evaluate on themselves —
 * fail-soft, the module's rule (nestSpineFamilies precedent).
 */
function familySurvivalFilter(
	sessions: DsiSessionSummary[],
	matches: (row: DsiSessionSummary) => boolean
): DsiSessionSummary[] {
	const byId = new Set(sessions.map((s) => s.sessionId));
	const kidsByParent = new Map<string, DsiSessionSummary[]>();
	const isNested = new Set<string>();
	for (const row of sessions) {
		const parent = row.parentSessionId ?? null;
		if (parent === null) continue;
		if (!byId.has(parent)) continue; // orphan → root behavior (I4)
		const list = kidsByParent.get(parent) ?? [];
		list.push(row);
		kidsByParent.set(parent, list);
		isNested.add(row.sessionId);
	}
	const subtreeHasMatch = (row: DsiSessionSummary, seenLocal: Set<string>): boolean => {
		if (seenLocal.has(row.sessionId)) return false; // cycle cut
		seenLocal.add(row.sessionId);
		if (matches(row)) return true;
		return (kidsByParent.get(row.sessionId) ?? []).some((k) => subtreeHasMatch(k, seenLocal));
	};
	const keep = new Set<string>();
	const markSubtree = (row: DsiSessionSummary): void => {
		if (keep.has(row.sessionId)) return; // cycle cut
		keep.add(row.sessionId);
		for (const kid of kidsByParent.get(row.sessionId) ?? []) markSubtree(kid);
	};
	for (const row of sessions) {
		if (isNested.has(row.sessionId)) continue;
		if (subtreeHasMatch(row, new Set())) markSubtree(row);
	}
	for (const row of sessions) {
		if (!keep.has(row.sessionId) && matches(row)) keep.add(row.sessionId);
	}
	return sessions.filter((s) => keep.has(s.sessionId));
}

/**
 * Running-first ranking (2026-08-26): live sessions float to the top of
 * the spine — the green dot leads. The host's recency order is the
 * tiebreak INSIDE each group (stable sort: running rows stay recency-
 * ordered among themselves, idle rows likewise), so this only splits the
 * list into two recency-preserving bands. Pure ordering — filters decide
 * membership; this ranks survivors. Callers apply it AFTER
 * applySessionFilter; the pinned current session and paneled sessions
 * never reach it (rendered elsewhere by contract).
 */
export function rankRunningFirst(sessions: DsiSessionSummary[]): DsiSessionSummary[] {
	return [...sessions].sort((a, b) => Number(b.running) - Number(a.running));
}
