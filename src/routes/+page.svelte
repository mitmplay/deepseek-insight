<script lang="ts">
	/**
	 * Workspace route — the panel floor owner (Panel Floor W3 task 3.1,
	 * ADR-0006 R1/R2/R6). ONE page holds N conversation panels side by
	 * side; the URL stops naming the session and becomes a ONE-SHOT SEED:
	 *
	 *   /?sessionKey=…     → SEED: reset panels to [that session],
	 *                        select, persist, replaceState → /
	 *   /                  → RESTORE: panels/selection/width/zoom from
	 *                        localStorage['dsi-panels']
	 *
	 * Route layout (spec-check GAP-7): one flat route — the seed session
	 * rides the ?sessionKey= query (OCI orchestration's ?sessionKey=
	 * shape), so the page serves both arrivals and the seed can never
	 * 404 on a missing path segment. +page.server.ts cold-loads ONLY the
	 * seed session (its load guards: no param → no host call,
	 * bare-restore stays cheap); panels added at runtime dual-fetch
	 * client-side (spec-check GAP-1): /events?full=1 (entries+lastSeq+
	 * running+ pending/settledAnswers — the ledger-tail resync surface)
	 * + /history (hasMore). BC-1: every byte via /api/dsh/*.
	 *
	 * The agent rides the session, not the URL (ADR-0006 R3): the seed
	 * panel's agentPreset comes from the server load's session.row; a
	 * runtime-added panel gets it from its caller (sidebar rows) or the
	 * live spine summaries.
	 *
	 * Ownership (OCI floor split): panels, selection, panelWidth, zoom,
	 * drag math, registry registration, persistence, seed-vs-restore.
	 * Sidebar/gutter ACTIONS arrive through panel-registry (leaf→root,
	 * commitment 2); workspace STATE flows down through
	 * workspace-context (R6) for the W4 sidebar panel list.
	 *
	 * Route note (2026-09-02, the Root-is-the-Floor ADR): this page moved
	 * from /conversation to / and the homepage session list retired — the
	 * sidebar spine is the session list. The former route group layout's
	 * remount key stayed retired with the move: the sessionId remount key
	 * once tore the whole workspace down on every panel swap (2026-08-23
	 * regression); since W2 the store lives in ConversationPanel (keyed
	 * per panel), so the layout key guarded nothing and the layout is
	 * gone. Each panel column keys its ConversationPanel by
	 * `panel.sessionId`, so a replace/add/select remounts ONLY the
	 * affected panel.
	 */
	import { onMount } from 'svelte';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { appConfig } from '$lib/services/config/app-config.svelte';
	import AppSidebar from '$lib/components/common/layout/AppSidebar.svelte';
	import ConversationPanel from '$lib/components/chat/ConversationPanel.svelte';
	import PromptManagerPanel from '$lib/components/prompt-manager/PromptManagerPanel.svelte';
	import TerminalDesk from '$lib/components/terminal/TerminalDesk.svelte';
	import SettingsSkillsPanel from '$lib/components/settings-skills/SettingsSkillsPanel.svelte';
	import SettingsEditorPanel from '$lib/components/panels/SettingsEditorPanel.svelte';
	import InjectedDocPanel from '$lib/components/panels/InjectedDocPanel.svelte';
	import WorkspaceExplorerPanel from '$lib/components/panels/WorkspaceExplorerPanel.svelte';
	import WorkspaceFilePanel from '$lib/components/panels/WorkspaceFilePanel.svelte';
	import PanelsZoom from '$lib/components/panels/PanelsZoom.svelte';
	import PanelColumn from '$lib/components/panels/PanelColumn.svelte';
	import PanelLoupe from '$lib/components/panels/PanelLoupe.svelte';
	import StickyColumnContainer from '$lib/components/panels/StickyColumnContainer.svelte';
	import EmptyFloor from '$lib/components/panels/EmptyFloor.svelte';
	import ControlBar from '$lib/components/panels/control-bar/ControlBar.svelte';
	import {
		registerAddPanel,
		registerMovePanel,
		registerReplacePanel,
		registerReplacePanelBySession,
		registerReplaceSelected,
		registerSelectPanel,
		registerStartPanelResize,
		type PanelAddRequest,
		type PanelMoveDir
	} from '$lib/services/panels/panel-registry';
	import { setWorkspaceState, type PanelRow } from '$lib/services/conversation/workspace-context.svelte';
	import { pruneSync, resetSync } from '$lib/services/chat/prompt-sync.svelte';
	import { deriveLineage, ghostRowsFor } from '$lib/services/lineage/lineage';
	import { moveFactsFrom, movePanelLineage, replaceTarget, afterSourceSlot } from '$lib/services/lineage/lineage-move';
	import {
		clampPanelWidth,
		clampPanelZoom,
		clampTreePct,
		shelfPanelWidth,
		loadPanelPrefs,
		PANEL_WORKSPACE_EXPLORER_WIDTH,
	PANEL_WORKSPACE_FILE_WIDTH,
		savePanelPrefs
	} from '$lib/utils/panel-prefs';
	import { sanitizeWorkspaceProfile } from '$lib/utils/storage-profile';
	import { conversationSeedUrl } from '$lib/utils/seed-url';
	import { clampSidebarWidth, loadSidebarPrefs, saveSidebarPrefs } from '$lib/utils/sidebar-prefs';
	import type {
		DsiConversationPanel,
		DsiEntry,
		DsiInjectedDocPanel,
		DsiPanelEntry,
		DsiSkillShelfPanel,
		DsiWorkspaceExplorerPanel,
	DsiWorkspaceFilePanel,
		DsiPreset,
		DsiSessionSummary,
		DsiA2aExchangeView,
		TerminalDeskMirror
	} from '$lib/types';
	import type { ReloadFeedback } from '$lib/utils/skill-shelf-reload-machine';
	import {
	findInjectedDocPanel,
	focusedInsertionSlot,
	findWorkspaceExplorerPanel,
	findWorkspaceFilePanel,
	injectedDocSlot,
	workspaceExplorerSlot,
	workspaceFileSlot,
	lineagePinnedSlot,
	wireParentOf,
	adoptionChain
} from '$lib/services/panels/panel-placement';
import { isUniformRow, movePanelWithin, resizeOne, scaleProportionally } from '$lib/services/panels/floor-math';
import { spineFeed, subscribeSpineFeed } from '$lib/services/conversation/spine-feed.svelte';
import {
		ghostPanelRowsFor,
		openSessionIdsOf,
		panelHeaderLabel,
		panelRowsFor,
		rowFactsByPanelId as rowFactsOf,
		type PanelRowsCold
	} from '$lib/services/panels/panel-rows';

	// ── Seed-vs-restore resolution (R1) ─────────────────────────────────
	/** The seed key — present only on a fresh /?sessionKey=…
	 *  arrival (the strip effect clears the URL below). */
	function seedSessionId(): string | null {
		const fromQuery = page.url.searchParams.get('sessionKey');
		if (fromQuery !== null && fromQuery.length > 0) return fromQuery;
		return null;
	}

	/** The workspace profile — STICKY (?profile= survives the strip; it
	 *  keys the localStorage desk: dsi-panels vs dsi-panels_<profile>).
	 *  Captured ONCE at init: one page load = one desk. Null = default. */
	const activeProfile = sanitizeWorkspaceProfile(page.url.searchParams.get('profile') ?? '');

	/** Monotonic panel id source (panel-N, OCI shape). */
	let panelIdSeq = 0;
	function nextPanelId(): string {
		panelIdSeq += 1;
		return `panel-${panelIdSeq}`;
	}

	/** Duplicate-key guard (2026-08-24 crash fix): a bare arrival restores
	 *  panels from the persisted blob — ids like panel-1..panel-N from a
	 *  PREVIOUS page load — while panelIdSeq still sits at 0, so the first
	 *  runtime add would mint panel-1 AGAIN and the keyed each in
	 *  SidebarOpenPanels would crash (each_key_duplicate). Syncing the
	 *  sequence past every restored panel-N id makes runtime ids strictly
	 *  fresh. (sanitizePanels dedupes the blob itself — belt and braces.) */
	function syncPanelIdSeq(entries: DsiPanelEntry[]): void {
		for (const p of entries) {
			const m = /^panel-(\d+)$/.exec(p.id);
			if (m) panelIdSeq = Math.max(panelIdSeq, Number(m[1]));
		}
	}

	/** Cold-load shape the panels consume (server seed + dual fetch). */
	interface ColdLoad {
		title: string | null;
		workspace: string | null;
		agentPreset: string | null;
		entries: DsiEntry[];
		lastSeq: number;
		running: boolean;
		hasMore: boolean;
		pendingAnswers: import('$lib/types').PendingAnswer[];
		settledAnswers: import('$lib/types').AnsweredSettlement[];
		/** ADR-0007: the access mode rides the dual fetch (full=1 carries
		 *  the tail's projections value + raw knob events). */
		permission: import('$lib/services/conversation/permission-state').DsiPermission | null;
		/** Host admission numbers (imageLimits projection; null → defaults). */
		imageLimits: import('$lib/services/conversation/image-limits').DsiImageLimits | null;
		knobEvents: import('$lib/services/conversation/dsh-events').DshRawEvent[];
	}

	function makePanel(sessionId: string, agentPreset: string | null): DsiConversationPanel {
		return {
			id: nextPanelId(),
			kind: 'conversation',
			sessionId,
			agentPreset,
			width: clampPanelWidth(panelWidth)
		};
	}

	/** A terminal floor slot (Web Terminal spec Wave 5, 2026-09-24): no
	 *  session, no preset — the panel self-gates on terminal.enabled. */
	function makeTerminalPanel(): DsiPanelEntry {
		return {
			id: nextPanelId(),
			kind: 'terminal',
			width: clampPanelWidth(panelWidth)
		};
	}

	/** A prompt-manager floor slot (ADR D6/D8): no session, no preset —
	 *  the embedded manager content is W4's mount; this wave only mints
	 *  the entry so the union, persistence, and rows are honest. */
	function makeManagerPanel(): DsiPanelEntry {
		return {
			id: nextPanelId(),
			kind: 'prompt-manager',
			width: clampPanelWidth(panelWidth)
		};
	}

	/** A skill-shelf floor slot (The Skill Shelf ADR, 2026-09-20, D1):
	 *  no session, no preset — the panel reads /api/skills itself. */
	function makeSkillShelfPanel(): DsiPanelEntry {
		return {
			id: nextPanelId(),
			kind: 'skill-shelf',
			width: shelfPanelWidth()
		};
	}



	/** Skill-shelf chrome intents (hard-reload survival, the
	 *  explorer-tab pattern): the shelf emits tab / collapsed-set /
	 *  search changes; the owner writes them onto the persisted entry
	 *  — panel-prefs saves the blob, a reload restores all three. */
	function setShelfTab(panelId: string, tab: 'install' | 'uninstall'): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0 || panels[idx].kind !== 'skill-shelf') return;
		panels = panels.with(idx, { ...(panels[idx] as DsiSkillShelfPanel), tab });
	}

	function setShelfCollapsed(panelId: string, collapsed: string[]): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0 || panels[idx].kind !== 'skill-shelf') return;
		panels = panels.with(idx, { ...(panels[idx] as DsiSkillShelfPanel), collapsed });
	}

	function setShelfSearch(panelId: string, q: string): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0 || panels[idx].kind !== 'skill-shelf') return;
		panels = panels.with(idx, { ...(panels[idx] as DsiSkillShelfPanel), searchQ: q });
	}

	function setShelfReload(panelId: string, reload: ReloadFeedback | null): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0 || panels[idx].kind !== 'skill-shelf') return;
		panels = panels.with(idx, { ...(panels[idx] as DsiSkillShelfPanel), reload });
	}

	/** An injected-doc floor slot (Loadinjected ADR D2): a lineage CHILD of
	 *  its conversation over the LOGGED payload — the viewer content is
	 *  W4's mount (the manager's D6 staging). */
	function makeInjectedDocPanel(sourceSessionId: string, displayPath: string): DsiPanelEntry {
		return {
			id: nextPanelId(),
			kind: 'injected-doc',
			sourceSessionId,
			displayPath,
			width: clampPanelWidth(panelWidth)
		};
	}

	/** A workspace-explorer floor slot (Workspace Explorer W3 task 3.2,
	 *  ADR D2/D4): the LIVE tree over the session's workspace root.
	 *  expanded starts empty — F5 restore refills it from the blob.
	 *  Width = the WIDE file band, unconditionally (The Settings Tree
	 *  ADR 2026-09-18 D1: the explorer layout is the only layout). */
	function makeWorkspaceExplorerPanel(sessionId: string, root: string): DsiWorkspaceExplorerPanel {
		return {
			id: nextPanelId(),
			kind: 'workspace-explorer',
			sessionId,
			root,
			expanded: [],
			width: clampPanelWidth(PANEL_WORKSPACE_FILE_WIDTH, 'workspace-explorer')
		};
	}

	/** A settings-home explorer (The Settings Tree ADR 2026-09-18, D2/D3):
	 *  a SESSION-LESS workspace-explorer over ~/.dsi or ~/.dsh, titled —
	 *  the /dsi-settings · /dsh-settings content. `home` selects the
	 *  DSI-local data plane; `sessionId: null` is honest provenance. */
	function makeSettingsHomePanel(home: 'dsi' | 'dsh'): DsiWorkspaceExplorerPanel {
		const root = appConfig().settingsHomes[home];
		return {
			id: nextPanelId(),
			kind: 'workspace-explorer',
			sessionId: null,
			root,
			title: home === 'dsi' ? 'DSI - Settings' : 'DSH - Settings',
			home,
			expanded: [],
			width: clampPanelWidth(PANEL_WORKSPACE_FILE_WIDTH, 'workspace-explorer')
		};
	}

	/** Chip click action (The Shared Tree ADR 2026-09-17, D2): ONE
	 *  explorer per WORKSPACE root across ALL sessions — a click on any
	 *  session sharing the root FOCUSES the open explorer (dedupe
	 *  key = root, D1); a fresh root lands at the focused slot (D3,
	 *  non-lineage — the explorer is not a lineage child). sessionId
	 *  stays in the signature (the chip supplies it) and rides the fresh
	 *  panel as PROVENANCE (D4), never as identity. */
	function openWorkspaceExplorer(sessionId: string, workspace: string): void {
		const open = findWorkspaceExplorerPanel(panels, workspace);
		if (open) {
			selectedPanelId = open.id; // dedupe-to-focus (D2, root key)
			return;
		}
		insertPanel(
			makeWorkspaceExplorerPanel(sessionId, workspace),
			workspaceExplorerSlot(panels, selectedIndex, moveFacts)
		);
	}

	/** The open explorer for a session's workspace (The Shared Tree D1):
	 *  matched by ROOT across sessions — the panel's provenance sessionId
	 *  is not the key. */
	function sessionWorkspaceExplorer(sessionId: string): DsiWorkspaceExplorerPanel | undefined {
		const root = panelWorkspaceFor(sessionId);
		return root === null ? undefined : findWorkspaceExplorerPanel(panels, root);
	}

	/** Explorer tree intents (Module Communication Map): the panel emits
	 *  toggle/open-file; the owner mutates expanded (the persisted part) —
	 *  the levels cache stays component-local. File open is W4's wiring. */
	function toggleExplorerPath(panelId: string, path: string): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0 || panels[idx].kind !== 'workspace-explorer') return;
		const explorer = panels[idx] as DsiWorkspaceExplorerPanel;
		const next = explorer.expanded.includes(path)
			? explorer.expanded.filter((p) => p !== path)
			: [...explorer.expanded, path];
		panels = panels.with(idx, { ...explorer, expanded: next });
	}

	/** Explorer collapse-all intent (Module Communication Map): the panel
	 *  emits; the owner empties the expanded list (the persisted part) —
	 *  the levels cache is component-local and simply stops rendering. */
	function collapseExplorerPaths(panelId: string): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0 || panels[idx].kind !== 'workspace-explorer') return;
		panels = panels.with(idx, { ...(panels[idx] as DsiWorkspaceExplorerPanel), expanded: [] });
	}

	/** Git Eye tab intent (2026-09-12 operator request): the active tab is
	 *  PERSISTED on the entry — a hard reload restores it (supersedes the
	 *  ADR D5 remount-Explorer clause, amendment logged). */
	function setExplorerTab(panelId: string, tab: 'explorer' | 'changes'): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0 || panels[idx].kind !== 'workspace-explorer') return;
		panels = panels.with(idx, { ...(panels[idx] as DsiWorkspaceExplorerPanel), tab });
	}

	/** Explorer Layout tabs (amendment 2026-09-16): the tab list and the
	 *  active tab are OWNER-PERSISTED entry facts — panel-prefs saves the
	 *  blob, so a hard reload restores the open tabs exactly like
	 *  expanded/tab/collapsedRepos. The file tabs die with the panel (D5). */
	function openExplorerTab(panelId: string, path: string): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0 || panels[idx].kind !== 'workspace-explorer') return;
		const ex = panels[idx] as DsiWorkspaceExplorerPanel;
		const tabs = ex.openTabs ?? [];
		const openTabs = tabs.includes(path) ? tabs : [...tabs, path];
		panels = panels.with(idx, { ...ex, openTabs, activeFile: path });
	}

	function closeExplorerTab(panelId: string, path: string): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0 || panels[idx].kind !== 'workspace-explorer') return;
		const ex = panels[idx] as DsiWorkspaceExplorerPanel;
		const tabs = ex.openTabs ?? [];
		const closedAt = tabs.indexOf(path);
		if (closedAt === -1) return;
		const openTabs = tabs.filter((p) => p !== path);
		const activeFile =
			ex.activeFile === path
				? (openTabs.length === 0 ? null : openTabs[Math.max(0, closedAt - 1)])
				: (ex.activeFile ?? null);
		panels = panels.with(idx, { ...ex, openTabs, activeFile });
	}

	function activateExplorerTab(panelId: string, path: string): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0 || panels[idx].kind !== 'workspace-explorer') return;
		const ex = panels[idx] as DsiWorkspaceExplorerPanel;
		if (!(ex.openTabs ?? []).includes(path)) return;
		panels = panels.with(idx, { ...ex, activeFile: path });
	}

	/** The Explorer Layout drag settle (ADR D4): one DESK fact on the
	 *  route — the split is desk state, persisted with the floor blob,
	 *  NOT per entry. The panel already clamped; clamp again at the
	 *  single bound site for defense in depth. */
	function setExplorerTreePct(_panelId: string, pct: number): void {
		treePct = clampTreePct(pct);
	}

	/** Git Eye repo-collapse intent (2026-09-13): the collapsed repo set is
	 *  PERSISTED on the entry — a hard reload restores it (the explorer-tab
	 *  pattern). Default is EXPANDED: an absent/empty list collapses nothing. */
	function toggleExplorerRepo(panelId: string, repoRel: string): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0 || panels[idx].kind !== 'workspace-explorer') return;
		const explorer = panels[idx] as DsiWorkspaceExplorerPanel;
		const prev = explorer.collapsedRepos ?? [];
		const next = prev.includes(repoRel) ? prev.filter((r) => r !== repoRel) : [...prev, repoRel];
		panels = panels.with(idx, { ...explorer, collapsedRepos: next });
	}

	/** Git Eye collapse-all-repos intent (2026-09-13): on the Changes tab
	 *  the toolbar's collapse-all collapses EVERY known repo — persisted
	 *  like the single-repo toggle, so a hard reload restores it. */
	function collapseExplorerRepos(panelId: string, repos: readonly string[]): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0 || panels[idx].kind !== 'workspace-explorer') return;
		const explorer = panels[idx] as DsiWorkspaceExplorerPanel;
		const next = [...new Set([...(explorer.collapsedRepos ?? []), ...repos])];
		panels = panels.with(idx, { ...explorer, collapsedRepos: next });
	}

	/** File Eye view intent (2026-09-13): diff vs edit is PERSISTED on the
	 *  entry — a hard reload restores it (the explorer-tab pattern). */
	function setFileView(panelId: string, view: 'edit' | 'diff'): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0 || panels[idx].kind !== 'workspace-file') return;
		panels = panels.with(idx, { ...(panels[idx] as DsiWorkspaceFilePanel), view });
	}

	/** A workspace-file floor slot (Workspace Explorer W4, ADR D2): the
	 *  LIVE view over one real file — the (sessionId, path) pair is the
	 *  dedupe key; content re-fetches on mount by design. explorerPanelId
	 *  is the stored lineage edge to its explorer (2026-09-10 fix) — the
	 *  move grammar's membership test reads it. */
	function makeWorkspaceFilePanel(
		sessionId: string,
		path: string,
		explorerPanelId: string | null
	): DsiPanelEntry {
		return {
			id: nextPanelId(),
			kind: 'workspace-file',
			sessionId,
			path,
			explorerPanelId,
			width: clampPanelWidth(PANEL_WORKSPACE_FILE_WIDTH, 'workspace-file')
		};
	}

	/** The file panel's root (the copy fallback): its explorer's root
	 *  when open (Shared Tree D1 — root-keyed, any session's explorer),
	 *  else the session's workspace from the spine/cold rows. */
	function filePanelRoot(sessionId: string): string {
		return (
			sessionWorkspaceExplorer(sessionId)?.root ??
			panelWorkspaceFor(sessionId) ??
			''
		);
	}

	/** Tree file-click action (The Settings Tree ADR 2026-09-18 D1: the
	 *  explorer layout is the ONLY layout — the retired floor-file branch
	 *  of the 2026-09-17 ADR is gone). The intent publishes to the
	 *  session's explorer, which opens/focuses a tab. No open explorer
	 *  ⇒ the intent drops (the browsing surface that opens files IS the
	 *  explorer; the floor keeps conversations only). */
	function openWorkspaceFile(sessionId: string, path: string): void {
		const host = sessionWorkspaceExplorer(sessionId); // Shared Tree D1: the root key
		if (host) publishFileIntent(host.id, path);
	}



	// Seed cold data — captured SYNCHRONOUSLY at init from page.data (the
	// seed route's server load) BEFORE the panels init below (the seed
	// panel's agentPreset is the session row's, not the URL's) and before
	// the seed-strip effect runs: replaceState('/') makes the
	// router re-load the bare route (empty data), so reading page.data in
	// onMount races the strip and can miss the seed panel's cold payload
	// entirely.
	// svelte-ignore state_referenced_locally
	const seedData = page.data as
		| {
				sessionId: string;
				title: string | null;
				workspace: string | null;
				agentPreset?: string | null;
				entries: DsiEntry[];
				lastSeq: number;
				running: boolean;
				hasMore?: boolean;
				pendingAnswers?: ColdLoad['pendingAnswers'];
				settledAnswers?: ColdLoad['settledAnswers'];
				permission?: ColdLoad['permission'];
				imageLimits?: ColdLoad['imageLimits'];
				knobEvents?: ColdLoad['knobEvents'];
		  }
		| undefined;
	// svelte-ignore state_referenced_locally
	const seedCold =
		seedData && typeof seedData.sessionId === 'string' && Array.isArray(seedData.entries)
			? {
					title: seedData.title ?? null,
					workspace: seedData.workspace ?? null,
					agentPreset: seedData.agentPreset ?? null,
					entries: seedData.entries,
					lastSeq: seedData.lastSeq ?? -1,
					running: seedData.running ?? false,
					hasMore: seedData.hasMore ?? false,
					pendingAnswers: seedData.pendingAnswers ?? [],
					settledAnswers: seedData.settledAnswers ?? [],
					permission: seedData.permission ?? null,
					imageLimits: seedData.imageLimits ?? null,
					knobEvents: seedData.knobEvents ?? []
			  }
			: undefined;

	// ── Workspace state (R2: one blob, one persistence effect) ─────────
	// svelte-ignore state_referenced_locally
	const seededInitially = seedSessionId() !== null;
	// svelte-ignore state_referenced_locally
	const initialPrefs = loadPanelPrefs(activeProfile);
	// Width preset FIRST (makePanel reads it during the seed reset below).
	// svelte-ignore state_referenced_locally
	let panelWidth = $state(initialPrefs.panelWidth);
	// svelte-ignore state_referenced_locally
	let zoom = $state(clampPanelZoom(initialPrefs.zoom));
	// The Explorer Layout (ADR 2026-09-17 D4): the split's desk fact —
	// clamped through the single bound site, persisted with the blob.
	let treePct = $state(clampTreePct(initialPrefs.treePct));
	// Intentional initial capture: the seed RESETS the workspace to one
	// panel (R1); a bare arrival restores the stored blob. The seed
	// panel's agentPreset is the SESSION ROW's (server load), never the
	// URL's — the ?agent= param is retired (ADR-0006 R3).
	// svelte-ignore state_referenced_locally
	let panels = $state<DsiPanelEntry[]>(
		seededInitially ? [makePanel(seedSessionId()!, seedCold?.agentPreset ?? null)] : initialPrefs.panels
	);
	// Crash fix (2026-08-24): the sequence must clear every RESTORED id
	// too, or the first runtime add re-mints an existing panel-N.
	// Intentional initial capture: the restored set is an init-time fact.
	// svelte-ignore state_referenced_locally
	syncPanelIdSeq(panels);
	/** The one terminal desk's ref (Terminal Desk ADR D1/D2, Wave 2): the
	 *  floor forwards the parsed command action (--new-tab / --split-down)
	 *  into the desk's methods when the desk is already open — repeat bare
	 *  stays focus-only. */
	/** The desk's published structure mirror, by panel id (Terminal Desk
	 *  ADR D3, Wave 3): read at savePanelPrefs time — the $effect that
	 *  persists the floor serializes each terminal entry's desk field.
	 *  A copy, never the authority; the probe adjudicates on rebuild. */
	let terminalDeskMirrors = $state<Record<string, TerminalDeskMirror>>({});
	let terminalDeskRef: { applyAction: (action: 'new-tab' | 'split-down') => void } | null = $state(null);
	// svelte-ignore state_referenced_locally
	let selectedPanelId = $state<string | null>(
		seededInitially ? panels[0]?.id ?? null : initialPrefs.selectedPanelId
	);
	/** Which panel the loupe reads (The Panel Loupe ADR D5, 2026-09-04):
	 *  session-local by decision — never persisted (the R2 effect above
	 *  saves only the floor fields); a refresh loses the lens. Null =
	 *  closed; a dead id self-clears through clearLoupeIfGone. */
	let loupePanelId = $state<string | null>(null);

	/** Runtime cold-load results per sessionId (dual fetch results). */
	let coldCache = $state<Record<string, ColdLoad | undefined>>({});

	// ── The Explorer Layout (ADR 2026-09-17 D3): the file-intent publish
	// point. In 'explorer' layout openWorkspaceFile does NOT slot a floor
	// panel — it publishes an intent to the session's explorer panel, which
	// consumes it once-per-nonce and reports back through
	// onPendingOpenConsumed (the publish then clears; D5's tab state is the
	// panel's, not the route's).
	let pendingFileIntents = $state<Record<string, { path: string; nonce: number } | null>>({});
	let fileIntentSeq = 0;

	/** Publish a file intent to an explorer panel and focus it. */
	function publishFileIntent(explorerId: string, path: string): void {
		pendingFileIntents[explorerId] = { path, nonce: ++fileIntentSeq };
		selectedPanelId = explorerId;
	}

	/** The panel consumed intent nonce N — clear exactly that publish. */
	function consumeFileIntent(explorerId: string, nonce: number): void {
		if (pendingFileIntents[explorerId]?.nonce === nonce) {
			pendingFileIntents[explorerId] = null;
		}
	}

	if (seededInitially && seedCold !== undefined && seedData !== undefined) {
		// Seed cache primes BEFORE first render — the panel mounts with full
		// cold props on paint one (SSR parity for the seed path). Intentional
		// initial capture: the seed's cold payload is a load-time constant.
		// svelte-ignore state_referenced_locally
		coldCache = { ...coldCache, [seedData.sessionId]: seedCold };
	}
	/** Sessions with a cold fetch in flight (loading placeholder guard). */
	let coldInFlight = $state<Set<string>>(new Set());
	/** Sessions whose cold load FAILED on the host (honest error card,
	 *  commitment 7) — keyed by sessionId. */
	let deadSessions = $state<Record<string, string>>({});
	/** Parent edges known at ADD time but not yet on the wire (the fork
	 *  child: doAdd's afterSessionId). spineRows stays the authority —
	 *  this only fills the one-to-two ticks before the child's list row
	 *  arrives, so a panel can publish parented from paint one (the fold
	 *  reveal and the header's parent button read the same edge). */
	let edgeCache = $state<Record<string, string>>({});

	// ── Persistence (R2: one effect, every change) ──────────────────────
	$effect(() => {
		savePanelPrefs(
			{
				panels: panels.map((p) =>
					// The desk mirror rides the terminal entry (D3): read here so
					// a mirror change re-runs this effect and persists.
					 p.kind === 'terminal' && terminalDeskMirrors[p.id] ? { ...p, desk: terminalDeskMirrors[p.id] } : p
				),
				selectedPanelId,
				panelWidth,
				zoom,
				treePct
			},
			activeProfile
		);
	});

	// ── Prompt Sync hygiene (ADR "The Prompt Sync" D1/D6) ───────────────
	// A session that left the floor — closed, /new-swapped, family-removed
	// — holds no check and no pristine snapshot; the count hitting 0 also
	// clears the broadcast text (the box hides with nothing up its sleeve).
	$effect(() => {
		// Conversation sessions only (ADR D6): a manager slot carries no
		// session, so Prompt Sync has nothing to prune for it.
		pruneSync(
			new Set(
				panels
					.filter((p): p is DsiConversationPanel => p.kind === 'conversation')
					.map((p) => p.sessionId)
			)
		);
	});

	// ── Seed strip (R1: one-shot — refresh restores, never re-seeds) ────
	// afterNavigate + one microtask, NOT a raw $effect: $app/navigation's
	// replaceState throws "Cannot call replaceState before router is
	// initialized" during hydration — SvelteKit's client fires the
	// hydration-pass afterNavigate callbacks synchronously BEFORE it sets
	// started = true (client.js: after_navigate_callbacks.forEach →
	// restore_snapshot → started = true, one block). Deferring a
	// microtask lets that block finish; on later in-app navigations the
	// router is already started and the deferral is a no-op. This bug was
	// live in dev for the path-param seed too — e2e only ever ran against
	// fresh builds, where the effect's timing passed by accident.
	//
	// The strip removes ONLY sessionKey (the one-shot seed). Other params
	// SURVIVE — the profile convention: ?profile=widi stays in the bar so
	// a refresh keeps resolving the same localStorage desk
	// (dsi-panels_widi); with no other params the bar lands on the bare
	// / exactly as before.
	afterNavigate(() => {
		if (!seededInitially) return;
		void Promise.resolve().then(() => {
			const clean = new URL(page.url);
			clean.searchParams.delete('sessionKey');
			replaceState(clean.pathname + clean.search + clean.hash, {});
		});
	});

	// ── Selection / removal (state operations, not registry actions) ────
	// Selection sources: the sidebar panel-list row (registry action), the
	// floor's own activation (pointerdown/focusin anywhere inside a panel
	// column, 2026-08-25 — interacting with a conversation focuses its
	// panel; PanelColumn.onactivate), and remove's fallback.
	const selected = $derived(panels.find((p) => p.id === selectedPanelId) ?? null);
	const selectedIndex = $derived(panels.findIndex((p) => p.id === selectedPanelId));
	/** The louvered panel — the dialog's gate and content source; null
	 *  when closed or when its panel has left the floor. ANY kind lenses
	 *  (The Loupe for Every Panel, 2026-09-08): the body ladder
	 *  kind-switches before the session path, so the dialog renders the
	 *  manager/settings/injected-doc branch its panel carries. */
	const loupePanel = $derived(panels.find((p) => p.id === loupePanelId) ?? null);

	/** Dismiss the lens — the loupe host's close meaning for BOTH the
	 *  dialog's own ×/mask/Escape and the body content's close verb (the
	 *  snippet's hostClose override; a lens copy closes itself, the floor
	 *  slot stays). */
	function closeLoupe(): void {
		loupePanelId = null;
	}

	/** A lens of nothing renders nothing (the PRD's route row): every
	 *  floor mutation that can remove a panel id — close (family or
	 *  single), a /new swap minting a fresh id — clears the loupe when
	 *  its panel is gone. The gate below would hide the dialog anyway;
	 *  this keeps the state honest instead of stale. */
	function clearLoupeIfGone(): void {
		if (loupePanelId !== null && !panels.some((p) => p.id === loupePanelId)) {
			loupePanelId = null;
		}
	}

	function selectPanel(panelId: string): void {
		if (panels.some((p) => p.id === panelId)) selectedPanelId = panelId;
	}

	function removePanel(panelId: string, opts: { family?: boolean } = {}): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx < 0) return;
		// Subtree removal (operator spec, 2026-08-28): closing a panel
		// closes its WHOLE family — every descendant sub-agent panel goes
		// with it, nested included (the closure walks the wire lineage
		// transitively; the old re-home-as-orphan design left dangling
		// children on the floor). Only panels actually on the floor drop;
		// the removed sessions simply return to the spine.
		//
		// The Shift+Click amendment (2026-09-01): the panel header's close
		// with Shift held opts OUT — family === false — and only THAT panel
		// drops. The children stay on the floor and re-root as orphan
		// family heads (their depth degrades and the root controls return —
		// the §8 orphan rule); their sessions were never touched.
		const root = panels[idx];
		// Manager close (ADR D6): no session, no family walk — the slot
		// drops alone (the subtree walk below skips session-less kinds).
		const rootSessionId = root.kind === 'conversation' ? root.sessionId : null;
		const doomed = new Set<string>(rootSessionId !== null ? [rootSessionId] : []);
		const selectedSession =
			panels.find((p) => p.id === selectedPanelId)?.kind === 'conversation'
				? (panels.find((p): p is DsiConversationPanel => p.id === selectedPanelId && p.kind === 'conversation')
						?.sessionId ?? null)
				: null;
		if (opts.family !== false && rootSessionId !== null) {
			const stack = [rootSessionId];
			while (stack.length > 0) {
				for (const kid of lineageFacts.childrenByParent.get(stack.pop()!) ?? []) {
					if (!doomed.has(kid.sessionId)) {
						doomed.add(kid.sessionId);
						stack.push(kid.sessionId);
					}
				}
			}
		}
		// The ROOT always drops (by id for the manager kind, by session for
		// conversations); conversation descendants ride the doomed set, and
		// the session's workspace pair closes with it (2026-09-10): the
		// explorer/file are lineage CHILDREN of the doomed session — the
		// block grammar carries them, so the family closure must too.
		// Closing an EXPLORER (2026-09-10 fix) dooms its file children BY
		// PANEL ID — the stored explorerPanelId edge, with the legacy
		// null-edge fallback (shared session) — otherwise closing the tree
		// stranded its file panels on the floor.
		const doomedPanelIds = new Set<string>();
		if (opts.family !== false && root.kind === 'workspace-explorer') {
			for (const p of panels) {
				if (
					p.kind === 'workspace-file' &&
					(p.explorerPanelId === root.id ||
						(p.explorerPanelId === null && p.sessionId === root.sessionId))
				) {
					doomedPanelIds.add(p.id);
				}
			}
		}
		panels = panels.filter(
			(p) =>
				p.id !== root.id &&
				!doomedPanelIds.has(p.id) &&
				(p.kind === 'conversation'
					? !doomed.has(p.sessionId)
					: !('sessionId' in p) ||
						p.sessionId === null || // a settings-home explorer dies with the close, not with a session
						(opts.family !== false && !doomed.has(p.sessionId)))
		);
		if (selectedPanelId !== null && !panels.some((p) => p.id === selectedPanelId)) {
			selectedPanelId = panels[Math.min(idx, panels.length - 1)]?.id ?? null;
		}
		clearLoupeIfGone();
	}

	/** Registry move action: reorder via the pure helper; selection is
	 *  id-keyed, so the active panel follows the move with nothing to
	 *  repair (see movePanelWithin). */
	function doMovePanel(panelId: string, dir: PanelMoveDir): void {
		// Direction grammar: the header's left/right and the sidebar's
		// up/down are the SAME array reorder (legacy movePanelWithin mapped
		// left≡up, right≡down) — the pin treats them identically.
		const vertical: 'up' | 'down' = dir === 'left' || dir === 'up' ? 'up' : 'down';
		// Lineage Pin (W3 task 3.2): unit-aware move — child sub-units swap
		// within the sibling range; roots leap whole family blocks. null =
		// not offered (the row's buttons are hidden via canMoveUp/Down).
		const next = movePanelLineage(panels, panelId, vertical, moveFacts);
		if (next !== null) panels = next;
	}

	// ── Sidebar panel rows (W4 4.1/4.3) — derived from sessions + cold ──
	/** Spine feed (KB E4, W8): rows/presets/a2a live in the module-scope
	 *  reactive store (ref-counted single timer — BC-7/S3); these
	 *  aliases keep every downstream read reactive over the store.
	 *  Offline spines keep the previous rows (cold-title fallback). */
	const spineRows = $derived(spineFeed.rows);
	const spinePresets = $derived(spineFeed.presets);
	/** Host workspace registry — the header chip's title-first authority
	 *  (ADR D5 parity with the sidebar chips; 2026-09-07). */
	const spineWorkspaces = $derived(spineFeed.workspaces);
	const a2aRows = $derived(spineFeed.a2aRows);

	/** Live titles keyed by sessionId — the chips show target titles. */
	const spineTitles = $derived.by(() => {
		const t: Record<string, string | null> = {};
		for (const s of spineRows) t[s.sessionId] = s.title;
		return t;
	});



	/** The store's lifecycle entry (W8): the subscription starts the
	 *  ref-counted feed timer on mount and stops it on destroy — the
	 *  a2a window rides the floor's conversation senders (first sender
	 *  per tick, never per panel). */
	$effect(() => {
		return subscribeSpineFeed(() => conversationPanels.map((p) => p.sessionId));
	});

	/** Live panel title (2026-08-24 header bug): spine (host truth, 5s
	 *  refresh) first, cold-load fallback — the SAME merge the sidebar
	 *  rows use. The cold load is one-shot: a session the host names only
	 *  AFTER its panel opened (first-turn auto-title) would otherwise
	 *  never reach the panel headers, while the sidebar healed on every
	 *  spine tick. Consumed by each panel's ConversationPanel (its
	 *  SessionIdAndName cluster); the floor PanelHeader shows only the
	 *  session id (2026-08-25). */
	function panelTitleFor(sessionId: string): string | null {
		return (
			spineRows.find((s) => s.sessionId === sessionId)?.title ??
			coldCache[sessionId]?.title ??
			null
		);
	}

	/** Live panel workspace (2026-08-25): the SAME spine-first merge as
	 *  panelTitleFor — the runtime dual fetch carries no session row
	 *  (workspace: null there), so a restored or sidebar-added panel
	 *  would never render its workspace chip without the spine healing
	 *  it. The seed panel's cold load does carry the row; the spine
	 *  keeps both honest as the host's truth changes. */
	function panelWorkspaceFor(sessionId: string): string | null {
		return (
			spineRows.find((s) => s.sessionId === sessionId)?.workspace ??
			coldCache[sessionId]?.workspace ??
			null
		);
	}

	/** Live parent session id (2026-09-01 fork lineage): the spine row's
	 *  parentSessionId — the header's parent button jump target. Spine-
	 *  only: the host records the edge durably, so the next tick heals
	 *  any panel that opened before the row arrived. The add-time edge
	 *  cache fills those same first ticks (fork child). */
	function panelParentFor(sessionId: string): string | null {
		return (
			spineRows.find((s) => s.sessionId === sessionId)?.parentSessionId ??
			edgeCache[sessionId] ??
			null
		);
	}

	/** Conversation branch of the floor (ADR D6): every session-keyed
	 *  derivation below consumes this view — a manager slot never reaches
	 *  lineage, the spine joins, or the cold ladder by type. */
	const conversationPanels = $derived(
		panels.filter((p): p is DsiConversationPanel => p.kind === 'conversation')
	);
	/** Lineage facts (2026-08-27 W2 task 2.2, ADR D1/D2): the family map
	 *  derived from the live spine feed — depth, running-descendants
	 *  roll-up, ghost set, suppression set. Pure derivation (services/
	 *  lineage); the route only feeds it. Re-derived every tick. */
	const lineageFacts = $derived(deriveLineage(spineRows, conversationPanels));
	/** Move facts (W3 task 3.2): the floor-aware parent-of view
	 *  movePanelLineage consumes — same derivation, slim shape. */
	const moveFacts = $derived(moveFactsFrom(lineageFacts, openSessionIdsOf(panels)));

	/** The rows themselves live in services/panels/panel-rows.ts (KB E1
	 *  extraction, 2026-09-06): pure functions over this route's per-tick
	 *  inputs. The cold cache is structurally the ColdLoad record — the
	 *  service reads only title/workspace/running (PanelRowsCold). */
	const rowInputs = $derived({
		panels,
		spineRows,
		coldCache: coldCache as Readonly<Record<string, PanelRowsCold | undefined>>,
		deadSessions,
		edgeCache,
		lineageFacts,
		moveFacts
	});
	const panelRows = $derived(panelRowsFor(rowInputs));
	const rowFactsByPanelId = $derived(rowFactsOf(panelRows));
	const ghostRows = $derived(ghostPanelRowsFor(rowInputs));

	/** Live agent preset for a session — spine row first, panel entry
	 *  fallback. The agent retired from the URL into the session row
	 *  (ADR-0006 R3): the seed gets it from the server load, runtime
	 *  panels from their caller, and any panel the 5s spine refresh can
	 *  heal (e.g. paste-to-add, whose caller knows only the id). */
	function agentFor(panel: DsiConversationPanel): string | null {
		return panel.agentPreset ?? spineRows.find((s) => s.sessionId === panel.sessionId)?.agentPreset ?? null;
	}

	/** Agent chip label (DSH picker parity): the host's display name when
	 *  the catalog carries one, else the raw id. Display ONLY — the wire
	 *  (session.create /new, panel registry) always takes the id from
	 *  agentFor; a display name sent as agentPreset is a preset-not-found
	 *  RPC error. */
	function agentLabelFor(panel: DsiConversationPanel): string | null {
		const id = agentFor(panel);
		if (id === null) return null;
		return spinePresets.find((p) => p.id === id)?.name ?? id;
	}

	/** W4 4.2: one panel's sender-side ledger rows, newest first — the
	 *  chip join's per-panel slice of the page's single /api/a2a window. */
	function a2aRowsFor(sessionId: string): DsiA2aExchangeView[] {
		return a2aRows.filter((r) => r.fromSession === sessionId);
	}

	// ── Registry actions (R6: leaf→root; mount→register, destroy→clear) ─
	/** Swap-focus slot (2026-08-29): the panel id whose NEXT
	 *  ConversationPanel mount focuses its composer — set from
	 *  PanelAddRequest.focus (the /new successor swap), cleared when the
	 *  fresh panel fires oncomposerfocus. A marker whose panel never
	 *  mounts (a dead-session error card) stays inert: panel ids are
	 *  unique and never remount. Null on every plain page load, so a
	 *  restored desk never steals focus. */
	let focusComposerId = $state<string | null>(null);

	/** Insert a panel entry at `index` (splice helper, pin-aware). */
	function insertPanel(entry: DsiPanelEntry, index: number): void {
		const next = [...panels];
		next.splice(Math.min(index, next.length), 0, entry);
		panels = next;
		selectedPanelId = entry.id;
	}

	/** Insert-before-focused slot (operator spec, 2026-08-31): a fresh
	 *  panel lands at the FOCUSED panel's index — immediately before it —
	 *  and takes focus (insertPanel selects it). 0 when nothing is
	 *  focused (empty floor, stale selection) — the old front-add stays
	 *  the fallback. Math.max keeps splice's negative-index semantics
	 *  out of the no-selection case.
	 *
	 *  Family clamp (lineage I2): a slot strictly inside a family would
	 *  wedge the newcomer between a spawner and its pinned child —
	 *  unitOf/blockBounds, the sidebar's familyRenderOrder, and the
	 *  adoption slot walk all assume families stay contiguous on the
	 *  floor. When the focus is a family CHILD, the slot climbs to the
	 *  family head — the nearest non-splitting slot left of the focus
	 *  (moveFacts.parentOf only carries on-floor parents, so an orphan
	 *  child is a root here, its own unit). A lone panel or a family
	 *  head keeps the exact focus slot. */
		function insertionSlot(): number {
		return focusedInsertionSlot(panels, selectedIndex, moveFacts.parentOf);
	}

	/** Lineage-order slot below an OPEN spawner (operator spec,
	 *  2026-08-28): after the spawner AND after every already-adopted
	 *  sibling that PRECEDES the child in wire order — plus those
	 *  siblings' own panels (an adopted subtree travels whole). Ghost
	 *  clicks and sub-agent replacements keep the family region in the
	 *  ghost list's order regardless of arrival sequence: adopting sub2
	 *  then sub3 lands |A|sub2|sub3|, a late sub1 slots back to
	 *  |A|sub1|sub2|sub3|. */
		function pinnedSlotIndex(parentSessionId: string, childSessionId: string): number {
		return lineagePinnedSlot(panels, lineageFacts.childrenByParent, parentSessionId, childSessionId);
	}

	function doAdd(request: PanelAddRequest): void {
		// Manager branch (ADR D6/D7): no session, no dedupe (two live
		// managers are legal, D3), no lineage placement — the slot lands
		// directly right of the afterSessionId anchor (the --add composer's
		// panel), else before the focused panel. No cold fetch: the manager
		// reads /api/prompts itself.
		// Settings-home branch (The Settings Tree ADR 2026-09-18 D2): the
		// explorer's OWN dedupe runs FIRST (Shared Tree D1 — the root is the
		// key), so a repeat /dsi-settings FOCUSES the open home panel.
		if (request.kind === 'settings-home') {
			const root = appConfig().settingsHomes[request.home];
			const open = findWorkspaceExplorerPanel(panels, root);
			if (open) {
				selectedPanelId = open.id;
				return;
			}
			const anchorIdx =
				request.afterSessionId !== undefined
					? panels.findIndex(
							(p) => p.kind === 'conversation' && p.sessionId === request.afterSessionId
						)
					: -1;
			insertPanel(
				makeSettingsHomePanel(request.home),
				anchorIdx >= 0 ? anchorIdx + 1 : insertionSlot()
			);
			return;
		}
		if (request.kind === 'terminal') {
			// One live terminal (the manager-request grammar, spec Wave 5; the
			// Terminal Desk ADR 2026-09-24 D2): the open desk takes the FOCUS;
			// only a miss inserts. request.action ('new-tab' | 'split-down')
			// rides the request to Wave 2's desk — with no desk open, all
			// three command shapes land here and create tab[0]/row[0].
			const open = panels.find((p) => p.kind === 'terminal');
			if (request.action && terminalDeskRef) terminalDeskRef.applyAction(request.action);
			if (open) {
				selectedPanelId = open.id;
				return;
			}
			const anchorIdx =
				request.afterSessionId !== undefined
					? panels.findIndex(
							(p) => p.kind === 'conversation' && p.sessionId === request.afterSessionId
						)
					: -1;
			insertPanel(makeTerminalPanel(), anchorIdx >= 0 ? anchorIdx + 1 : insertionSlot());
			return;
		}
		if (request.kind === 'prompt-manager') {
			// One live manager (The Focus Command ADR 2026-09-17, D3): the
			// open manager takes the FOCUS; only a miss inserts. Symmetric
			// with the settings-home root dedupe below.
			const open = panels.find((p) => p.kind === 'prompt-manager');
			if (open) {
				selectedPanelId = open.id;
				return;
			}
			const anchorIdx =
				request.afterSessionId !== undefined
					? panels.findIndex(
							(p) => p.kind === 'conversation' && p.sessionId === request.afterSessionId
						)
					: -1;
			insertPanel(makeManagerPanel(), anchorIdx >= 0 ? anchorIdx + 1 : insertionSlot());
			return;
		}
		if (request.kind === 'skill-shelf') {
			// One live shelf (The Skill Shelf ADR, 2026-09-20, D1): the open
			// shelf takes the FOCUS; only a miss inserts. Same grammar as the
			// manager branch above.
			const open = panels.find((p) => p.kind === 'skill-shelf');
			if (open) {
				selectedPanelId = open.id;
				return;
			}
			const anchorIdx =
				request.afterSessionId !== undefined
					? panels.findIndex(
							(p) => p.kind === 'conversation' && p.sessionId === request.afterSessionId
						)
					: -1;
			insertPanel(makeSkillShelfPanel(), anchorIdx >= 0 ? anchorIdx + 1 : insertionSlot());
			return;
		}
		// Injected-doc branch (Loadinjected ADR D3/D5): dedupe per the
		// (sourceSessionId, displayPath) pair — a prevented double load
		// FOCUSES the open panel (selection + sidebar highlight, nothing
		// added); new inserts directly BELOW the source conversation panel
		// (the fork-child slot rule), selected (insertPanel's default).
		if (request.kind === 'injected-doc') {
			const open = findInjectedDocPanel(panels, request.sourceSessionId, request.displayPath);
			if (open) {
				selectedPanelId = open.id; // dedupe→focus (D5)
				return;
			}
			insertPanel(
				makeInjectedDocPanel(request.sourceSessionId, request.displayPath),
				injectedDocSlot(panels, request.sourceSessionId, insertionSlot())
			);
			return;
		}
		const existing = panels.find(
			(p) => p.kind === 'conversation' && p.sessionId === request.sessionId
		);
		if (existing) {
			selectedPanelId = existing.id; // dedupe→select (commitment 7)
			return;
		}
		// keepSelection (the /new --add request, 2026-09-06): the selection
		// BEFORE the insert — restored after the newcomer lands so the
		// focused panel (and the operator's caret) stays put. Snapshotted
		// here, before insertPanel can move it.
		const selectionBefore = selectedPanelId;
		// Lineage Pin (W3 task 3.2, ADR D4): a sub-agent NEVER lands past
		// its family — pinned directly below its spawner when the spawner
		// is open, else the whole family comes along (never travels
		// alone). CHAIN adoption (operator spec, 2026-08-28): clicking a
		// NESTED ghost brings every OFF-FLOOR ancestor with it, pinned
		// under the nearest OPEN ancestor — with |A| open, clicking
		// nested1 lands |A|sub1|nested1|, never a dangling child. New
		// panels INSERT BEFORE THE FOCUSED PANEL (operator call,
		// 2026-08-31, replacing the 2026-08-28 front-unshift): a fresh
		// panel joins at the focused panel's index and takes focus; the
		// front survives only as the nothing-focused fallback. A family
		// with NO open ancestor joins the same way, whole (head first);
		// only the lineage pin places a child elsewhere (below its open
		// spawner).
		const placement = replaceTarget(panels, request.sessionId, lineageFacts);
		if (placement.kind === 'pinned') {
			// Lineage-order adoption: the pinnedSlotIndex comment owns the
			// contract (click sequence irrelevant, family region ordered).
			insertPanel(
				makePanel(request.sessionId, request.agentPreset),
				pinnedSlotIndex(placement.parentSessionId, request.sessionId)
			);
		} else if (placement.kind === 'adopt-family') {
			// The off-floor ancestor chain, NEAREST first (the direct
			// spawner leads); the walk stops at the nearest OPEN ancestor.
			const { chain, anchor } = adoptionChain(
				lineageFacts.childrenByParent,
				placement.parentSessionId,
				(sid) => panels.some((p) => p.kind === 'conversation' && p.sessionId === sid)
			);
			// Contiguous insertion: the TOPMOST missing ancestor's slot
			// (lineage-ordered under the open anchor; the focused slot with
			// none — the whole family joins before the focus), then the
			// chain downward, then the clicked child.
			let index =
				anchor !== null ? pinnedSlotIndex(anchor, chain[chain.length - 1]) : insertionSlot();
			for (const sid of [...chain].reverse()) {
				insertPanel(makePanel(sid, null), index);
				index += 1;
			}
			insertPanel(makePanel(request.sessionId, request.agentPreset), index);
			for (const sid of chain) void ensureCold(sid);
		} else {
			// After-source placement (the fork child, 2026-09-01): the slot
			// anchors to the request's afterSessionId — the fork SOURCE,
			// which keeps its slot — never the global selection (a click
			// during the async fork POST must not move the anchor).
			// afterSourceSlot's comment owns the family clamp; the fallback
			// covers an anchor with no panel (and the absent field).
			const slot =
				request.afterSessionId !== undefined
					? (afterSourceSlot(panels, request.afterSessionId, moveFacts) ?? insertionSlot())
					: insertionSlot();
			insertPanel(makePanel(request.sessionId, request.agentPreset), slot);
			// The edge rides the request before the wire has the child's
			// row (edgeCache's comment owns the contract).
			if (request.afterSessionId !== undefined) {
				edgeCache = { ...edgeCache, [request.sessionId]: request.afterSessionId };
			}
			// keepSelection: undo insertPanel's select-the-newcomer — the
			// request's anchor panel keeps the highlight (guarded: a stale
			// snapshot selects nothing).
			if (
				request.keepSelection === true &&
				selectionBefore !== null &&
				panels.some((p) => p.id === selectionBefore)
			) {
				selectedPanelId = selectionBefore;
			}
		}
		void ensureCold(request.sessionId);
	}

	/** Wire parent of a session from the lineage facts (null at a root
	 *  or off-wire id) — the chain-adoption walk's step. */
		function parentOfSession(sessionId: string): string | null {
		return wireParentOf(lineageFacts.childrenByParent, sessionId);
	}

	function doReplaceSelected(request: PanelAddRequest): void {
		if (panels.length === 0) {
			doAdd(request);
			return;
		}
		const idx = Math.max(selectedIndex, 0);
		doReplacePanel(panels[idx].id, request);
	}

	/**
	 * /new (2026-08-25): swap ONE addressed panel onto its successor session
	 * — the panel's own width and position are kept, a fresh id is minted
	 * (state fully resets), and the cold load starts immediately. Unknown
	 * panel id → no-op (the registry contract: never crash a leaf).
	 *
	 * Lineage Pin (W3 task 3.2, ADR D4): replacing with a SUB-AGENT never
	 * lands it in an arbitrary slot — it pins directly below its spawner
	 * (displaced panel shifts down); spawner off-floor → the family adopts
	 * the slot (parent takes it, child pins below). Sub-agents never
	 * travel alone.
	 */
	function doReplacePanel(panelId: string, request: PanelAddRequest): void {
		const idx = panels.findIndex((p) => p.id === panelId);
		if (idx === -1) return;
		// The settings-home and prompt-manager successor-swaps are retired
		// here (The Focus Command ADR 2026-09-17, D4): those commands aim a
		// panel via doAdd and never replace — a stray request of those kinds
		// is an honest no-op, never a swap. /new and /loadinjected keep
		// their swaps.
		if (request.kind === 'terminal' || request.kind === 'prompt-manager' || request.kind === 'settings-home' || request.kind === 'skill-shelf') {
			return;
		}
		// Injected-doc successor-swap (Loadinjected ADR D4: bare
		// /loadinjected replaces the panel it ran in): fresh id (full
		// remount), the slot's width kept, the newcomer selected. D5's
		// dedupe runs FIRST — a second copy never exists; the open panel
		// takes the focus instead of the swap.
		if (request.kind === 'injected-doc') {
			const open = findInjectedDocPanel(panels, request.sourceSessionId, request.displayPath);
			if (open) {
				selectedPanelId = open.id; // dedupe→focus (D5)
				return;
			}
			const entry = makeInjectedDocPanel(request.sourceSessionId, request.displayPath);
			entry.width = clampPanelWidth(panels[idx].width);
			panels = panels.map((p, i) => (i === idx ? entry : p));
			selectedPanelId = entry.id;
			clearLoupeIfGone();
			return;
		}
		const occupant = panels[idx];
		if (occupant.kind === 'conversation' && occupant.sessionId === request.sessionId) return; // same session

		doSwapInto(panelId, idx, request);
	}

	/** Session-addressed swap (Sectioned Row W3 2026-08-29): the run's
	 *  context survives /new retargets by SESSION, so resolve the LIVE
	 *  panel showing that session — the birth panel id died at the first
	 *  swap (fresh id + remount), and an id-addressed replace would
	 *  silently no-op on the dead slot. Miss → false (caller reports). */
	function doReplacePanelBySession(sessionId: string, request: PanelAddRequest): boolean {
		if (
			request.kind === 'terminal' ||
			request.kind === 'prompt-manager' ||
			request.kind === 'settings-home' ||
			request.kind === 'injected-doc' ||
			request.kind === 'skill-shelf'
		) {
			return false; // a swap by session needs a successor session
		}
		const idx = panels.findIndex((p) => p.kind === 'conversation' && p.sessionId === sessionId);
		if (idx === -1) return false;
		if ((panels[idx] as DsiConversationPanel).sessionId === request.sessionId) return true; // same session
		doSwapInto(panels[idx].id, idx, request);
		return true;
	}

	/** The shared swap body (W3 extraction): `slotPanelId` is the panel
	 *  CURRENTLY occupying the addressed slot — by id (typed /new) or by
	 *  session (the run's retargeted context) — so the lineage-placement
	 *  branches below compare against the live occupant, never a dead id. */
	function doSwapInto(slotPanelId: string, idx: number, request: PanelAddRequest): void {
		// Manager requests never REACH here (doReplacePanel handles the
		// manager successor-swap before the session ladder) — the guard is
		// defensive: a swap needs a successor session.
		if (
			request.kind === 'terminal' ||
			request.kind === 'prompt-manager' ||
			request.kind === 'settings-home' ||
			request.kind === 'injected-doc' ||
			request.kind === 'skill-shelf'
		)
			return; // defensive: a swap needs a successor session
		const panelId = slotPanelId;
		const placement = replaceTarget(panels, request.sessionId, lineageFacts);
		if (placement.kind === 'plain') {
			const entry: DsiConversationPanel = {
				id: nextPanelId(),
				kind: 'conversation',
				sessionId: request.sessionId,
				agentPreset: request.agentPreset,
				width: panels[idx].width
			};
			if (request.focus === true) focusComposerId = entry.id;
			panels = panels.map((p, i) => (i === idx ? entry : p));
			selectedPanelId = entry.id;
			clearLoupeIfGone();
			void ensureCold(request.sessionId);
			return;
		}

		const { parentSessionId } = placement;
		const parentExisting = panels.find(
			(p) => p.kind === 'conversation' && p.sessionId === parentSessionId
		);
		if (parentExisting !== undefined && parentExisting.id === panelId) {
			// Replacing the spawner with its own child: keep the parent in
			// the slot (dedupe→pin), child splices below — never orphan the
			// family the replacement would create. Lineage-order slot: an
			// already-adopted older sibling keeps the new child below it.
			const child = makePanel(request.sessionId, request.agentPreset);
			if (request.focus === true) focusComposerId = child.id;
			const occupantSession = panels[idx].kind === 'conversation' ? panels[idx].sessionId : null;
			insertPanel(
				child,
				occupantSession !== null
					? pinnedSlotIndex(occupantSession, request.sessionId)
					: pinnedSlotIndex(parentSessionId, request.sessionId)
			);
			void ensureCold(request.sessionId);
			return;
		}
		// Free the addressed slot, then place the family: pinned (spawner
		// open → the lineage-order slot below it) or adopt-family (spawner
		// takes the freed slot, child below it).
		const freed = panels.filter((p) => p.id !== panelId);
		panels = freed;
		clearLoupeIfGone();
		if (placement.kind === 'pinned') {
			const child = makePanel(request.sessionId, request.agentPreset);
			if (request.focus === true) focusComposerId = child.id;
			insertPanel(child, pinnedSlotIndex(parentSessionId, request.sessionId));
		} else {
			insertPanel(makePanel(parentSessionId, null), Math.min(idx, panels.length));
			const parentIndex = panels.findIndex(
			(p) => p.kind === 'conversation' && p.sessionId === parentSessionId
		);
			const child = makePanel(request.sessionId, request.agentPreset);
			if (request.focus === true) focusComposerId = child.id;
			insertPanel(child, parentIndex + 1);
			void ensureCold(parentSessionId);
		}
		void ensureCold(request.sessionId);
	}

	/** The panel index a gutter drag started on. */
	let dragStartIndex = -1;
	/** Gutter-drag snapshot (W5 5.2): start X, widths at mousedown, and
	 *  the mode — Shift held at mousedown scales ALL panels
	 *  proportionally; a plain drag resizes ONLY the dragged panel
	 *  (individual, 2026-08-28). */
	let drag: { startX: number; widths: number[]; shift: boolean } | null = null;

	/** Width-badge afterglow (2026-08-28): the panel ids whose width left
	 *  the drag snapshot at mouseup — badged through a 10s fade after the
	 *  drag ends. LIVE visibility is derived from `drag` + `panels` (the
	 *  changed-from-snapshot rule below); these two only carry the
	 *  afterglow phase between mouseup and the timeout. */
	let widthBadgeIds = $state<Set<string>>(new Set());
	let widthBadgeFading = $state(false);
	let widthBadgeTimer: ReturnType<typeof setTimeout> | null = null;

	function doStartPanelResize(e: MouseEvent, index: number): void {
		dragStartIndex = index;
		drag = { startX: e.clientX, widths: panels.map((p) => p.width), shift: e.shiftKey };
		// A new drag cancels any afterglow — badges go LIVE again (or hide
		// until a width actually leaves the new snapshot).
		if (widthBadgeTimer !== null) {
			clearTimeout(widthBadgeTimer);
			widthBadgeTimer = null;
		}
		widthBadgeFading = false;
		widthBadgeIds = new Set();
	}

	function onWindowMouseMove(e: MouseEvent): void {
		if (!drag) return;
		const delta = e.clientX - drag.startX;
		if (drag.shift) {
			// Shift+drag: proportional — every panel keeps its snapshot share.
			panels = scaleProportionally(panels, drag.widths, delta);
			return;
		}
		// Plain drag: individual — only the dragged panel's width moves
		// (2026-08-28); the neighbors keep their values.
		panels = resizeOne(panels, drag.widths, dragStartIndex, delta);
	}

	function onWindowMouseUp(): void {
		if (drag === null) return;
		// Arm the afterglow BEFORE clearing the snapshot: the changed set
		// (computed against `drag`) freezes into the fading ids.
		widthBadgeIds = changedBadgeIds();
		drag = null;
		widthBadgeFading = true;
		if (widthBadgeTimer !== null) clearTimeout(widthBadgeTimer);
		widthBadgeTimer = setTimeout(() => {
			widthBadgeFading = false;
			widthBadgeIds = new Set();
			widthBadgeTimer = null;
		}, 10_000);
		// Honest slider (mouseUP, never mid-drag): a drag that lands ALL
		// panels uniform syncs the width preset — the slider then tells the
		// truth; a mixed row leaves the preset untouched (the slider stays
		// the explicit resize-all tool, and dragging mixed rows does not
		// fib a uniform value it did not produce).
		if (isUniformRow(panels)) panelWidth = panels[0].width;
	}

	/** Panels whose width left the drag snapshot — the badge's honest
	 *  membership rule (2026-08-28): a plain drag badges ONLY the
	 *  resized panel (individual resize — neighbors keep their values,
	 *  a saturated panel stays clean); Shift+drag badges EVERY panel
	 *  (proportional scaling moves them all). Empty outside a drag. */
	function changedBadgeIds(): Set<string> {
		if (drag === null) return new Set();
		const ids = new Set<string>();
		for (let i = 0; i < panels.length; i++) {
			if (panels[i].width !== drag.widths[i]) ids.add(panels[i].id);
		}
		return ids;
	}

	/** Per-panel badge phase — 'live' while its width leaves the drag
	 *  snapshot, 'fading' through the 10s afterglow, absent otherwise.
	 *  Reads the plain `drag` on purpose (the single drag owner's
	 *  variable) — BUT both $state inputs are read UNCONDITIONALLY
	 *  before any early return: a $derived only tracks what an executed
	 *  path reads, and the drag-null no-badge path would otherwise
	 *  register no dependency at all, so the first mousemove's `panels`
	 *  write would never re-run it (the badge would never appear). */
	const badgeByPanelId = $derived.by(() => {
		const row = panels;
		const fading = widthBadgeFading;
		const map = new Map<string, 'live' | 'fading'>();
		if (drag !== null) {
			for (let i = 0; i < row.length; i++) {
				if (row[i].width !== drag.widths[i]) map.set(row[i].id, 'live');
			}
			return map;
		}
		if (fading) {
			for (const id of widthBadgeIds) map.set(id, 'fading');
		}
		return map;
	});

	// ── Runtime cold load — dual fetch (spec-check GAP-1) ───────────────
	async function fetchCold(sessionId: string): Promise<ColdLoad | null> {
		// /events?full=1 carries entries+lastSeq+running+pending/settled
		// answers (the ledger-tail resync surface); /history carries
		// hasMore. Its beforeSeq anchor needs the tail's lastSeq, so the
		// events response resolves first — the only serialization.
		const eventsRes = await fetch(
			`/api/dsh/session/${encodeURIComponent(sessionId)}/events?full=1`
		);
		if (!eventsRes.ok) return null;
		const events = (await eventsRes.json()) as {
			ok: boolean;
			entries?: DsiEntry[];
			lastSeq?: number;
			running?: boolean;
			pendingAnswers?: ColdLoad['pendingAnswers'];
			settledAnswers?: ColdLoad['settledAnswers'];
			permission?: ColdLoad['permission'];
			imageLimits?: ColdLoad['imageLimits'];
			knobEvents?: ColdLoad['knobEvents'];
			error?: { code: string; message: string };
		};
		if (!events.ok) return null;
		const lastSeq = events.lastSeq ?? -1;
		// Tail hasMore: /history requires beforeSeq; anchor just under the
		// tail — a non-empty older page means older history exists.
		let hasMore = false;
		const historyRes = await fetch(
			`/api/dsh/session/${encodeURIComponent(sessionId)}/history?beforeSeq=${lastSeq + 1}`
		);
		if (historyRes.ok) {
			const history = (await historyRes.json()) as {
				ok: boolean;
				entries?: DsiEntry[];
				hasMore?: boolean;
			};
			if (history.ok) hasMore = (history.entries?.length ?? 0) > 0 || history.hasMore === true;
		}
		return {
			title: null,
			workspace: null,
			// The dual fetch carries no session row — the panel's agent chip
			// falls back to the spine summaries (agentFor below).
			agentPreset: null,
			entries: events.entries ?? [],
			lastSeq,
			running: events.running ?? false,
			hasMore,
			pendingAnswers: events.pendingAnswers ?? [],
			settledAnswers: events.settledAnswers ?? [],
			permission: events.permission ?? null,
			imageLimits: events.imageLimits ?? null,
			knobEvents: events.knobEvents ?? []
		};
	}

	async function ensureCold(sessionId: string): Promise<void> {
		if (coldCache[sessionId] !== undefined || coldInFlight.has(sessionId)) return;
		coldInFlight = new Set(coldInFlight).add(sessionId);
		try {
			const cold = await fetchCold(sessionId);
			if (cold !== null) {
				coldCache = { ...coldCache, [sessionId]: cold };
			} else {
				// Honest state (commitment 7): the host no longer knows this
				// session — an error card with close, never a stuck loader or
				// a page crash. Sibling panels are unaffected (per-panel state).
				deadSessions = {
					...deadSessions,
					[sessionId]: `Session ${sessionId} not found on the DSH host. It may have been reaped.`
				};
			}
		} finally {
			const next = new Set(coldInFlight);
			next.delete(sessionId);
			coldInFlight = next;
		}
	}

	// ── ControlBar (W5 5.1): resize-all sets every panel + the preset ────
	/** Honest-slider's "slider sets all panels" leg (REALTIME, 2026-08-27:
	 *  SliderWidth fires per thumb move on `input`, matching SliderZoom's
	 *  live cadence): one width for every CONVERSATION column + the
	 *  uniform preset. 2026-09-13: the workspace kinds are FIXED lanes —
	 *  the explorer and file panels keep their own widths. */
	function resizeAll(width: number): void {
		panelWidth = clampPanelWidth(width);
		panels = panels.map((p) =>
			p.kind === 'conversation' ? { ...p, width: panelWidth } : p
		);
	}

	// ── App sidebar (OCI ControlRail port) — layout state page-owned ─────
	// Intentional initial capture: prefs seed the layout once; later store
	// writes go through the persistence effect below.
	// svelte-ignore state_referenced_locally
	const initialSidebarPrefs = loadSidebarPrefs(activeProfile);
	// svelte-ignore state_referenced_locally
	let sidebarCollapsed = $state(initialSidebarPrefs.collapsed);
	// svelte-ignore state_referenced_locally
	let sidebarWidth = $state(initialSidebarPrefs.width);

	/** The ConversationPage root (the flex row holding the rail,
	 *  ControlBar, and floor) — the sidebar header's canvas-copy button
	 *  capture target. bind:this fills it after mount; null until then
	 *  (SSR-safe: the button renders regardless, a pre-mount click is the
	 *  CanvasCopyButton null-container no-op). */
	let pageRoot = $state<HTMLElement | null>(null);

	/** The floor wrapper (PanelsZoom's layout slot) — the ControlBar
	 *  tray's canvas-copy capture target: the button copies THE FLOOR
	 *  (panels + workspace paint), not the whole page like the sidebar
	 *  header's button (pageRoot). Same container-down flow; null until
	 *  mount is the documented null-container no-op. */
	let floorEl = $state<HTMLElement | null>(null);

	function toggleSidebar(): void {
		sidebarCollapsed = !sidebarCollapsed;
	}

	$effect(() => {
		saveSidebarPrefs({ collapsed: sidebarCollapsed, width: sidebarWidth }, activeProfile);
	});

	let sidebarDrag: { startX: number; startWidth: number } | null = null;

	function startSidebarResize(e: MouseEvent): void {
		e.preventDefault();
		sidebarDrag = { startX: e.clientX, startWidth: sidebarWidth };
	}

	function onSidebarMouseMove(e: MouseEvent): void {
		if (!sidebarDrag) return;
		// Raw screen-px delta — unscaled ON PURPOSE, the same documented
		// quirk as panel gutters under zoom (ADR-0006 R8): in the
		// 'panels-zoom' placement the rail is transform-scaled, and its
		// drag delta stays screen-true (OCI rail-drag parity).
		sidebarWidth = clampSidebarWidth(sidebarDrag.startWidth + (e.clientX - sidebarDrag.startX));
	}

	function stopSidebarResize(): void {
		sidebarDrag = null;
	}

	// ── Sidebar placement (config sidebar.placement, 2026-08-26) ────────
	// 'none' (default): the rail sits BESIDE the floor — outside the zoom,
	//   never scaled, never scrolled away (the by-design layout).
	// 'panels-zoom': the rail becomes the floor's FIRST COLUMN, hosted by
	//   StickyColumnContainer (OCI ControlRail pattern) — it scales with
	//   zoom and scrolls with the row. Collapsed is placement-agnostic:
	//   the 34px stub ALWAYS renders beside the floor (OCI parity — the
	//   collapsed rail leaves the zoom row and takes no gutter with it).
	const sidebarPlacement = $derived(appConfig().sidebar.placement);
	/** True only while the rail is an in-zoom leading column (expanded). */
	const sidebarInZoom = $derived(sidebarPlacement === 'panels-zoom' && !sidebarCollapsed);

	// ── Mount: register registry actions + publish workspace context ────
	onMount(() => {
		registerAddPanel(doAdd);
		registerReplaceSelected(doReplaceSelected);
		registerReplacePanel(doReplacePanel);
		registerReplacePanelBySession(doReplacePanelBySession);
		registerSelectPanel(selectPanel);
		registerStartPanelResize(doStartPanelResize);
		registerMovePanel(doMovePanel);
		setWorkspaceState({
			get rows() {
				return panelRows;
			},
			get ghosts() {
				return ghostRows;
			},
			get selectedPanelId() {
				return selectedPanelId;
			},
			profile: activeProfile,
			select: selectPanel,
			remove: removePanel
		});
		return () => {
			// Registry lifecycle (commitment 8): clear ALL handlers on
			// destroy — invoke-after-destroy returns false.
			registerAddPanel(null);
			registerReplaceSelected(null);
			registerReplacePanel(null);
			registerReplacePanelBySession(null);
			registerSelectPanel(null);
			registerStartPanelResize(null);
			registerMovePanel(null);
			if (widthBadgeTimer !== null) clearTimeout(widthBadgeTimer);
			setWorkspaceState(null);
			// Prompt Sync teardown (ADR D6): checks are session-scoped —
			// a reload or route destroy starts clean.
			resetSync();
		};
	});
</script>

<svelte:window
	onmousemove={(e) => {
		onWindowMouseMove(e);
		onSidebarMouseMove(e);
	}}
	onmouseup={() => {
		onWindowMouseUp();
		stopSidebarResize();
	}}
/>

<svelte:head>
	<!-- i18n-skip: brand, never translated -->
	<title>Workspace — deepseek-insight</title>
</svelte:head>

{#snippet sidebarRail()}
	<!-- One rail component, two hosts (OCI railColumn snippet pattern):
	     the SAME markup renders beside the floor (standalone — owns its
	     width wrapper + gutter) or inside StickyColumnContainer (embedded
	     — the column owns both). Re-homing swaps the host site, so the
	     rail re-mounts — harmless: its only local state (the session
	     filter) re-seeds from session-filter-prefs, a persisted pref. -->
	<AppSidebar
		profile={activeProfile}
		collapsed={sidebarCollapsed}
		width={sidebarWidth}
		embedded={sidebarInZoom}
		currentSessionId={selected?.kind === 'conversation' ? selected.sessionId : ''}
		paneledSessionIds={conversationPanels.map((p) => p.sessionId)}
		captureContainer={pageRoot}
		onToggleCollapse={toggleSidebar}
		onResizeStart={startSidebarResize}
	/>
{/snippet}

<!-- The per-panel body ladder, ONE source for TWO render sites (The
     Panel Loupe ADR D7, 2026-09-04): the column renders it with the
     floor's panel id; the loupe renders the SAME ladder with
     `floorPanelId = null` — ConversationPanel's documented outside-floor
     shape (D3), so the lens's /new reports it cannot run here instead of
     editing the floor slot. Everything else — the dead card, the cold
     full-props mount, the onNeedCold mount — is byte-identical at both
     sites. -->
{#snippet panelBody(panel: DsiPanelEntry, floorPanelId: string | null, hostClose?: () => void)}
	{#if panel.kind === 'terminal'}
		<!-- Terminal branch (Web Terminal spec Wave 5) — kind switches before
		     the session path: a terminal slot has no session. The content
		     self-gates on terminal.enabled and owns its whole lifecycle. -->
		<div class="panel-manager-body" data-testid="panel-terminal">
			<!-- The desk (Terminal Desk ADR D1, Wave 2): tabs + rows in the ONE
			     terminal slot. Shell exit (its LAST shell) auto-closes the panel
			     the same way the header × did pre-desk. -->
			<TerminalDesk
				bind:this={terminalDeskRef}
				restored={panel.desk ?? null}
				onMirror={(m) => (terminalDeskMirrors[panel.id] = m)}
				onShellExit={() => removePanel(panel.id)}
			/>
		</div>
	{:else if panel.kind === 'prompt-manager'}
		<!-- Manager branch (ADR D6/D8) — KIND SWITCHES BEFORE THE SESSION
		     PATH: a manager slot has no session, so the dead/cold ladder
		     below is unreachable for it by type. The EMBEDDED host (W4):
		     root-scoped Escape (D3 — two managers close independently),
		     edit pair portaled under document.body (BC-7 — unscaled under
		     zoom), --mgr-bleed matched to the scroll box's padding, and
		     onclose removing the slot (the sidebar row leaves with it).
		     onchanged stays a lazy no-op (ADR fact 9: the strip refetches
		     on its next trigger, never eagerly). hostClose: in the lens the
		     content's close closes the LENS copy — the host decides what
		     close means (The Loupe for Every Panel, 2026-09-08). -->
		<div class="panel-manager-body" data-testid="panel-manager">
			<PromptManagerPanel
				onclose={hostClose ?? (() => removePanel(panel.id))}
				escapeScope="root"
				host="panel"
			/>
		</div>
	{:else if panel.kind === 'skill-shelf'}
		<!-- Skill-shelf branch (The Skill Shelf ADR, 2026-09-20, D1): the
		     content owns its fetches (/api/skills); close is PanelColumn's
		     chrome — the shelf takes no onclose (2026-09-21). -->
		<div class="panel-manager-body" data-testid="panel-skills">
			<SettingsSkillsPanel
				initialTab={panel.tab ?? 'install'}
				initialCollapsed={panel.collapsed ?? null}
				initialSearch={panel.searchQ ?? ''}
				initialReload={panel.reload ?? null}
				ontabchange={(v) => setShelfTab(panel.id, v)}
				oncollapsedchange={(ids) => setShelfCollapsed(panel.id, ids)}
				onsearchchange={(q) => setShelfSearch(panel.id, q)}
				onreloadchange={(r) => setShelfReload(panel.id, r)}
			/>
		</div>
	{:else if panel.kind === 'settings-editor'}
		<!-- Settings branch (Settings Panel ADR D3/D6, 2026-09-07): same
		     embedding rule as the manager — root-scoped Escape, onclose
		     removing the slot, the content owns its fetches (/api/settings). -->
		<div class="panel-manager-body" data-testid="panel-settings">
			<SettingsEditorPanel target={panel.target} onclose={hostClose ?? (() => removePanel(panel.id))} />
		</div>
	{:else if panel.kind === 'injected-doc'}
		<!-- Injected-doc branch (Loadinjected ADR D1/D2): the kind's SINGLE
		     floor content — extension-routed Markdown / Monaco readOnly over
		     the LOGGED payload, resolved from this conversation's transcript
		     snapshot (the floor's cold seed; no fetch). Root-scoped Escape +
		     onclose per the manager/settings embedding rule. -->
		<div class="panel-manager-body">
			<InjectedDocPanel
				sourceSessionId={panel.sourceSessionId}
				displayPath={panel.displayPath}
				entries={coldCache[panel.sourceSessionId]?.entries ?? []}
				onclose={hostClose ?? (() => removePanel(panel.id))}
			/>
		</div>
	{:else if panel.kind === 'workspace-explorer'}
		<!-- Explorer branch (Workspace Explorer ADR D2): the LIVE tree —
		     the panel fetches its own levels over the HTTP route and owns
		     that cache; the owner owns expanded (persisted) and the
		     open-file intent (W4). -->
		<WorkspaceExplorerPanel
			sessionId={panel.sessionId}
			root={panel.root}
			home={panel.home}
			expanded={panel.expanded}
			tab={panel.tab ?? 'explorer'}
			onToggle={(path) => toggleExplorerPath(panel.id, path)}
			onOpenFile={(path) => {
				if (panel.home !== undefined) {
					openExplorerTab(panel.id, path);
					return;
				}
				if (panel.sessionId !== null) openWorkspaceFile(panel.sessionId, path);
			}}
			onCollapseAll={() => collapseExplorerPaths(panel.id)}
			onTabChange={(tab) => setExplorerTab(panel.id, tab)}
			collapsedRepos={panel.collapsedRepos ?? []}
			onToggleRepo={(repoRel) => toggleExplorerRepo(panel.id, repoRel)}
			onCollapseAllRepos={(repos) => collapseExplorerRepos(panel.id, repos)}
			treePct={treePct}
			onTreePctChange={(pct) => setExplorerTreePct(panel.id, pct)}
			pendingOpenFile={pendingFileIntents[panel.id] ?? null}
			onPendingOpenConsumed={(nonce) => consumeFileIntent(panel.id, nonce)}
			openTabs={panel.openTabs ?? []}
			activeFile={panel.activeFile ?? null}
			onOpenTab={(path) => openExplorerTab(panel.id, path)}
			onCloseTab={(path) => closeExplorerTab(panel.id, path)}
			onActivateTab={(path) => activateExplorerTab(panel.id, path)}
		/>
	{:else if panel.kind === 'workspace-file'}
		<!-- File branch (Workspace Explorer W4, ADR D2): the LIVE file —
		     the panel fetches its own content over the HTTP route; root
		     feeds the copy fallback from its explorer / the session row. -->
		<WorkspaceFilePanel
			sessionId={panel.sessionId}
			path={panel.path}
			root={filePanelRoot(panel.sessionId)}
			view={panel.view ?? 'edit'}
			onviewchange={(v) => setFileView(panel.id, v)}
			onclose={() => removePanel(panel.id)}
		/>
	{:else if panel.kind === 'conversation'}
	{@const p = panel}
	{#key p.sessionId}
		{#if deadSessions[p.sessionId]}
			<div class="panel-error" data-testid="panel-error" role="alert">
				<p>{deadSessions[p.sessionId]}</p>
				<button
					type="button"
					data-testid="panel-error-close"
					onclick={() => removePanel(p.id)}
				>
					Close
				</button>
			</div>
			{:else if coldCache[p.sessionId]}
			{@const cold = coldCache[p.sessionId]!}
			<ConversationPanel
				panelId={floorPanelId}
				sessionId={p.sessionId}
				title={panelTitleFor(p.sessionId)}
				workspace={panelWorkspaceFor(p.sessionId)}
				workspaces={spineWorkspaces}
				agent={agentFor(p)}
				agentDisplay={agentLabelFor(p)}
				subagent={lineageFacts.subagentIds.has(p.sessionId)}
				depth={lineageFacts.depthById.get(p.sessionId) ?? 0}
				parentSessionId={panelParentFor(p.sessionId)}
				entries={cold.entries}
				lastSeq={cold.lastSeq}
				running={cold.running}
				hasMore={cold.hasMore}
				pendingAnswers={cold.pendingAnswers}
				settledAnswers={cold.settledAnswers}
				permission={cold.permission}
				imageLimits={cold.imageLimits ?? undefined}
				knobEvents={cold.knobEvents}
				a2aRows={a2aRowsFor(p.sessionId)}
				a2aTitles={spineTitles}
				onOpenExplorer={openWorkspaceExplorer}
				focusComposer={p.id === focusComposerId}
				oncomposerfocus={() => (focusComposerId = null)}
				focused={p.id === selectedPanelId}
			/>
			{:else if coldInFlight.has(p.sessionId)}
				<div class="panel-loading" data-testid="panel-loading">Loading…</div>
			{:else}
				<ConversationPanel
					panelId={floorPanelId}
					sessionId={p.sessionId}
					title={panelTitleFor(p.sessionId)}
					workspace={panelWorkspaceFor(p.sessionId)}
					workspaces={spineWorkspaces}
					agent={agentFor(p)}
					agentDisplay={agentLabelFor(p)}
					subagent={lineageFacts.subagentIds.has(p.sessionId)}
					depth={lineageFacts.depthById.get(p.sessionId) ?? 0}
					parentSessionId={panelParentFor(p.sessionId)}
					lastSeq={-1}
					running={false}
					a2aRows={a2aRowsFor(p.sessionId)}
					a2aTitles={spineTitles}
					onNeedCold={(sid) => void ensureCold(sid)}
					onOpenExplorer={openWorkspaceExplorer}
				focusComposer={p.id === focusComposerId}
					oncomposerfocus={() => (focusComposerId = null)}
					focused={p.id === selectedPanelId}
				/>
			{/if}
	{/key}
	{/if}
{/snippet}

<div class="flex h-dvh conversation-page" bind:this={pageRoot}>
	{#if !sidebarInZoom}
		<!-- Standalone rail: placement 'none', or 'panels-zoom' collapsed
		     (the 34px stub always renders beside the floor — OCI parity). -->
		{@render sidebarRail()}
	{/if}

	<ControlBar bind:panelWidth bind:zoom onresizeall={resizeAll} captureContainer={floorEl} />

	<!-- The floor wrapper: PanelsZoom's layout slot (flex:1 moves here;
	     the viewport fills it) and the tray canvas-copy's capture target
	     (bind:this → captureContainer down through ControlBar). -->
	<div class="floor" bind:this={floorEl}>
		<!-- railWidth rides the zoom frame's geometry fingerprint: mounting,
		     unmounting, or resizing the in-zoom rail re-measures the frame
		     (OCI `leading ? railWidth : ''`). -->
		<PanelsZoom {zoom} {panels} railWidth={sidebarInZoom ? sidebarWidth : null} {selectedPanelId}>
		{#if sidebarInZoom}
			<!-- Leading sticky column (OCI StickyColumnContainer): the rail
			     scales with zoom and scrolls with the row; its trailing
			     gutter exists only while panel columns follow. -->
			<StickyColumnContainer
				width={sidebarWidth}
				showGutter={panels.length > 0}
				onResizeStart={startSidebarResize}
			>
				{@render sidebarRail()}
			</StickyColumnContainer>
		{/if}
		{#each panels as panel, index (panel.id)}
				<PanelColumn
					{panel}
					{index}
					selected={panel.id === selectedPanelId}
					widthBadge={badgeByPanelId.get(panel.id) ?? null}
					copyValue={panel.kind === 'workspace-file'
						? filePanelRoot(panel.sessionId).replace(/\/+$/, '') + '/' + panel.path
						: undefined}
					canMoveLeft={(rowFactsByPanelId.get(panel.id)?.canMoveUp) ?? index > 0}
					canMoveRight={(rowFactsByPanelId.get(panel.id)?.canMoveDown) ?? index < panels.length - 1}
					onremove={(opts) => removePanel(panel.id, { family: opts?.shiftKey !== true })}
					onactivate={() => selectPanel(panel.id)}
					onloupe={() => (loupePanelId = panel.id)}
				>
					{@render panelBody(panel, panel.id)}
				</PanelColumn>
			{/each}
	</PanelsZoom>
	<!-- The empty floor centers over the whole floor, NOT inside the zoom
	     row (the row is width: max-content, so a 100%-wide child there
	     collapses to its own text width and cannot center). -->
	{#if panels.length === 0}
		<EmptyFloor />
	{/if}
	</div>

	{#if loupePanel !== null}
		<!-- The loupe at the route root, OUTSIDE .floor (The Panel Loupe
		     ADR D2): the DOM portals to document.body regardless — the
		     mount site keeps the component out of the zoom transform's
		     subtree. One loupe, never persisted (D5): Escape/mask/× clear
		     loupePanelId; closing the louvered panel from the floor clears
		     it through clearLoupeIfGone. ANY kind lenses (The Loupe for
		     Every Panel, 2026-09-08): the header rides the panel's label
		     variant, and the body snippet's hostClose makes the content's
		     close close the LENS copy, never the floor slot. -->
		<PanelLoupe
			panelId={loupePanel.id}
			sessionId={loupePanel.kind === 'conversation' ? loupePanel.sessionId : ''}
			label={panelHeaderLabel(loupePanel)}
			onclose={closeLoupe}
		>
			{@render panelBody(loupePanel, null, closeLoupe)}
		</PanelLoupe>
	{/if}
</div>

<style>
	.conversation-page {
		background-color: white;	
	}
	/* Embedded manager host (W4, ADR D8): the slot's scroll box — the
	   column gives the width, this box owns the vertical scroll the
	   modal got from .mgr-modal's overflow. NO padding: this host never
	   carries a session (the kind switch above guarantees it), and the
	   manager's own chrome pads its content; --mgr-bleed: 0 keeps the
	   sticky-header bleed aligned with the zero padding. */
	.panel-manager-body {
		height: 100%;
		overflow-y: auto;
		padding: 0;
		font-size: 0.8125rem;
		--mgr-bleed: 0rem;
	}
	/* Floor wrapper — takes over PanelsZoom's row slot (flex:1) and
	   hands the height down (the viewport fills it); bind:this makes it
	   the tray canvas-copy's capture target. */
	.floor {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}

	.panel-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		height: 100%;
		padding: 1rem;
		text-align: center;
		color: #b91c1c;
		background: #fef2f2;
		font-size: 0.8125rem;
	}

	.panel-error button {
		border: 1px solid #fca5a5;
		border-radius: 0.375rem;
		background: #fff;
		color: #b91c1c;
		padding: 0.25rem 0.75rem;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.panel-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-text-secondary, #6c757d);
		font-size: 0.875rem;
	}
</style>
