/**
 * floor-registry/grammar — the add / replace / move grammar (ADR-0022 W4).
 *
 * Moved WHOLE from the state home (floor-registry.svelte.ts): doAdd (the
 * one-live-per-kind dedupe ladder + lineage pin/adopt-chain/after-source
 * placement), the replace family (selected / by-panel / by-session), the
 * shared swap body doSwapInto, and the unit-aware registry move. Plain
 * module: every write goes through the state home's reactive `st` hub and
 * its primitives (ADR-0019 D2: exactly ONE writer home for floor state).
 * Sibling rule: factories/slots are reached through the state home's
 * re-export hub, never by importing another sibling directly.
 */
import { clampPanelWidth } from '$lib/utils/panel-prefs';
import {
	adoptionChain,
	findInjectedDocPanel,
	findWorkspaceExplorerPanel,
	injectedDocSlot
} from '$lib/services/panels/panel-placement';
import {
	movePanelLineage,
	replaceTarget,
	afterSourceSlot
} from '$lib/services/lineage/lineage-move';
import type { DsiConversationPanel, DsiPluginRackPanel, DsiSkillShelfPanel } from '$lib/types';
import type { PanelAddRequest, PanelMoveDir } from '$lib/services/panels/panel-registry';
import {
	st,
	floorSeam,
	nextPanelId,
	selectedIndex_,
	clearLoupeIfGone,
	clearFocusComposer,
	insertPanel,
	insertionSlot,
	pinnedSlotIndex,
	makePanel,
	makeTerminalPanel,
	makeManagerPanel,
	makeSkillShelfPanel,
	makePluginRackPanel,
	makeInjectedDocPanel,
	makeSettingsHomePanel
} from '$lib/services/panels/floor-registry.svelte';

const d = floorSeam;

/** Registry move action: reorder via the pure helper; selection is
 *  id-keyed, so the active panel follows the move with nothing to
 *  repair. Direction grammar: the header's left/right and the sidebar's
 *  up/down are the SAME array reorder. Lineage Pin (W3 task 3.2):
 *  unit-aware move — child sub-units swap within the sibling range;
 *  roots leap whole family blocks. */
export function doMovePanel(panelId: string, dir: PanelMoveDir): void {
	const vertical: 'up' | 'down' = dir === 'left' || dir === 'up' ? 'up' : 'down';
	const next = movePanelLineage(st.panels, panelId, vertical, d().getMoveFacts());
	if (next !== null) st.panels = next;
}

// ── Registry add / replace (the add grammar) ─────────────────────────
export function doAdd(request: PanelAddRequest): void {
	// Manager branch (ADR D6/D7): no session, no dedupe (two live
	// managers are legal, D3), no lineage placement — the slot lands
	// directly right of the afterSessionId anchor, else before the
	// focused panel. No cold fetch: the manager reads /api/prompts itself.
	// Settings-home branch (The Settings Tree ADR 2026-09-18 D2): the
	// explorer's OWN dedupe runs FIRST (Shared Tree D1 — the root is the
	// key), so a repeat /dsi-settings FOCUSES the open home panel.
	if (request.kind === 'settings-home') {
		const root = d().getSettingsHomes()[request.home];
		const open = findWorkspaceExplorerPanel(st.panels, root);
		if (open) {
			st.selectedPanelId = open.id;
			return;
		}
		const anchorIdx =
			request.afterSessionId !== undefined
				? st.panels.findIndex(
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
		// One live terminal (the manager-request grammar; the Terminal Desk
		// ADR 2026-09-24 D2): the open desk takes the FOCUS; only a miss
		// inserts. request.action rides to the desk when one is open.
		const open = st.panels.find((p) => p.kind === 'terminal');
		if (request.action) d().applyTerminalDeskAction(request.action);
		if (open) {
			st.selectedPanelId = open.id;
			return;
		}
		const anchorIdx =
			request.afterSessionId !== undefined
				? st.panels.findIndex(
						(p) => p.kind === 'conversation' && p.sessionId === request.afterSessionId
					)
				: -1;
		insertPanel(makeTerminalPanel(), anchorIdx >= 0 ? anchorIdx + 1 : insertionSlot());
		return;
	}
	if (request.kind === 'prompt-manager') {
		// One live manager (The Focus Command ADR 2026-09-17, D3): the open
		// manager takes the FOCUS; only a miss inserts.
		const open = st.panels.find((p) => p.kind === 'prompt-manager');
		if (open) {
			st.selectedPanelId = open.id;
			return;
		}
		const anchorIdx =
			request.afterSessionId !== undefined
				? st.panels.findIndex(
						(p) => p.kind === 'conversation' && p.sessionId === request.afterSessionId
					)
				: -1;
		insertPanel(makeManagerPanel(), anchorIdx >= 0 ? anchorIdx + 1 : insertionSlot());
		return;
	}
	if (request.kind === 'skill-shelf') {
		// One live shelf (The Skill Shelf ADR, 2026-09-20, D1): the open
		// shelf takes the FOCUS; only a miss inserts. BUG 2026-10-05:
		// --reload already rebuilt the snapshot server-side — bump the
		// session-only refresh token so the panel re-fetches.
		const open = st.panels.find((p) => p.kind === 'skill-shelf');
		if (open) {
			st.selectedPanelId = open.id;
			if (request.reload) {
				const idx = st.panels.indexOf(open);
				st.panels = st.panels.with(idx, {
					...(open as DsiSkillShelfPanel),
					refresh: ((open as DsiSkillShelfPanel).refresh ?? 0) + 1
				});
			}
			return;
		}
		const anchorIdx =
			request.afterSessionId !== undefined
				? st.panels.findIndex(
						(p) => p.kind === 'conversation' && p.sessionId === request.afterSessionId
					)
				: -1;
		insertPanel(makeSkillShelfPanel(), anchorIdx >= 0 ? anchorIdx + 1 : insertionSlot());
		return;
	}
	if (request.kind === 'plugin-rack') {
		// One live rack (The Plugin Rack ADR, 2026-09-27, D1): the open
		// rack takes the FOCUS; only a miss inserts. Same refresh-token
		// bump as the shelf's --reload dedupe.
		const open = st.panels.find((p) => p.kind === 'plugin-rack');
		if (open) {
			st.selectedPanelId = open.id;
			if (request.reload) {
				const idx = st.panels.indexOf(open);
				st.panels = st.panels.with(idx, {
					...(open as DsiPluginRackPanel),
					refresh: ((open as DsiPluginRackPanel).refresh ?? 0) + 1
				});
			}
			return;
		}
		const anchorIdx =
			request.afterSessionId !== undefined
				? st.panels.findIndex(
						(p) => p.kind === 'conversation' && p.sessionId === request.afterSessionId
					)
				: -1;
		insertPanel(makePluginRackPanel(), anchorIdx >= 0 ? anchorIdx + 1 : insertionSlot());
		return;
	}
	// Injected-doc branch (Loadinjected ADR D3/D5): dedupe per the
	// (sourceSessionId, displayPath) pair — a prevented double load
	// FOCUSES the open panel; new inserts directly BELOW the source
	// conversation panel (the fork-child slot rule), selected.
	if (request.kind === 'injected-doc') {
		const open = findInjectedDocPanel(st.panels, request.sourceSessionId, request.displayPath);
		if (open) {
			st.selectedPanelId = open.id; // dedupe→focus (D5)
			return;
		}
		insertPanel(
			makeInjectedDocPanel(request.sourceSessionId, request.displayPath),
			injectedDocSlot(st.panels, request.sourceSessionId, insertionSlot())
		);
		return;
	}
	const existing = st.panels.find(
		(p) => p.kind === 'conversation' && p.sessionId === request.sessionId
	);
	if (existing) {
		st.selectedPanelId = existing.id; // dedupe→select (commitment 7)
		return;
	}
	// keepSelection (the /new --add request, 2026-09-06): the selection
	// BEFORE the insert — restored after the newcomer lands so the
	// focused panel (and the operator's caret) stays put.
	const selectionBefore = st.selectedPanelId;
	// Lineage Pin (W3 task 3.2, ADR D4): a sub-agent NEVER lands past its
	// family — pinned directly below its spawner when the spawner is
	// open, else the whole family comes along (never travels alone).
	// CHAIN adoption (operator spec, 2026-08-28): clicking a NESTED ghost
	// brings every OFF-FLOOR ancestor with it, pinned under the nearest
	// OPEN ancestor. New panels INSERT BEFORE THE FOCUSED PANEL (operator
	// call, 2026-08-31); the front survives only as the fallback. A
	// family with NO open ancestor joins the same way, whole (head
	// first); only the lineage pin places a child elsewhere.
	const placement = replaceTarget(st.panels, request.sessionId, d().getLineageFacts());
	if (placement.kind === 'pinned') {
		// Lineage-order adoption: pinnedSlotIndex owns the contract.
		insertPanel(
			makePanel(request.sessionId, request.agentPreset),
			pinnedSlotIndex(placement.parentSessionId, request.sessionId)
		);
	} else if (placement.kind === 'adopt-family') {
		// The off-floor ancestor chain, NEAREST first; the walk stops at
		// the nearest OPEN ancestor. Contiguous insertion: the TOPMOST
		// missing ancestor's slot, then the chain downward, then the
		// clicked child.
		const { chain, anchor } = adoptionChain(
			d().getLineageFacts().childrenByParent,
			placement.parentSessionId,
			(sid) => st.panels.some((p) => p.kind === 'conversation' && p.sessionId === sid)
		);
		let index =
			anchor !== null ? pinnedSlotIndex(anchor, chain[chain.length - 1]) : insertionSlot();
		for (const sid of [...chain].reverse()) {
			insertPanel(makePanel(sid, null), index);
			index += 1;
		}
		insertPanel(makePanel(request.sessionId, request.agentPreset), index);
		for (const sid of chain) void d().ensureCold(sid);
	} else {
		// After-source placement (the fork child, 2026-09-01): the slot
		// anchors to the request's afterSessionId — the fork SOURCE, which
		// keeps its slot — never the global selection.
		const slot =
			request.afterSessionId !== undefined
				? (afterSourceSlot(st.panels, request.afterSessionId, d().getMoveFacts()) ?? insertionSlot())
				: insertionSlot();
		insertPanel(makePanel(request.sessionId, request.agentPreset), slot);
		// The edge rides the request before the wire has the child's row.
		if (request.afterSessionId !== undefined) {
			d().rememberEdge(request.sessionId, request.afterSessionId);
		}
		// keepSelection: undo insertPanel's select-the-newcomer (guarded:
		// a stale snapshot selects nothing).
		if (
			request.keepSelection === true &&
			selectionBefore !== null &&
			st.panels.some((p) => p.id === selectionBefore)
		) {
			st.selectedPanelId = selectionBefore;
		}
	}
	void d().ensureCold(request.sessionId);
}

export function doReplaceSelected(request: PanelAddRequest): void {
	if (st.panels.length === 0) {
		doAdd(request);
		return;
	}
	const idx = Math.max(selectedIndex_(), 0);
	doReplacePanel(st.panels[idx].id, request);
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
 * the slot (parent takes it, child pins below). Sub-agents never travel
 * alone.
 */
export function doReplacePanel(panelId: string, request: PanelAddRequest): void {
	const idx = st.panels.findIndex((p) => p.id === panelId);
	if (idx === -1) return;
	// The settings-home and prompt-manager successor-swaps are retired
	// here (The Focus Command ADR 2026-09-17, D4): those commands aim a
	// panel via doAdd and never replace — a stray request of those kinds
	// is an honest no-op, never a swap. /new and /loadinjected keep
	// their swaps.
	if (request.kind === 'terminal' || request.kind === 'prompt-manager' || request.kind === 'settings-home' || request.kind === 'skill-shelf' || request.kind === 'plugin-rack') {
		return;
	}
	// Injected-doc successor-swap (Loadinjected ADR D4: bare
	// /loadinjected replaces the panel it ran in): fresh id (full
	// remount), the slot's width kept, the newcomer selected. D5's
	// dedupe runs FIRST — a second copy never exists.
	if (request.kind === 'injected-doc') {
		const open = findInjectedDocPanel(st.panels, request.sourceSessionId, request.displayPath);
		if (open) {
			st.selectedPanelId = open.id; // dedupe→focus (D5)
			return;
		}
		const entry = makeInjectedDocPanel(request.sourceSessionId, request.displayPath);
		entry.width = clampPanelWidth(st.panels[idx].width);
		st.panels = st.panels.map((p, i) => (i === idx ? entry : p));
		st.selectedPanelId = entry.id;
		clearLoupeIfGone();
		return;
	}
	const occupant = st.panels[idx];
	if (occupant.kind === 'conversation' && occupant.sessionId === request.sessionId) return; // same session

	doSwapInto(panelId, idx, request);
}

/** Session-addressed swap (Sectioned Row W3 2026-08-29): the run's
 *  context survives /new retargets by SESSION. Miss → false (caller
 *  reports). */
export function doReplacePanelBySession(sessionId: string, request: PanelAddRequest): boolean {
	if (
		request.kind === 'terminal' ||
		request.kind === 'prompt-manager' ||
		request.kind === 'settings-home' ||
		request.kind === 'injected-doc' ||
		request.kind === 'skill-shelf' ||
		request.kind === 'plugin-rack'
	) {
		return false; // a swap by session needs a successor session
	}
	const idx = st.panels.findIndex((p) => p.kind === 'conversation' && p.sessionId === sessionId);
	if (idx === -1) return false;
	if ((st.panels[idx] as DsiConversationPanel).sessionId === request.sessionId) return true; // same session
	doSwapInto(st.panels[idx].id, idx, request);
	return true;
}

/** The shared swap body (W3 extraction): `slotPanelId` is the panel
 *  CURRENTLY occupying the addressed slot — by id (typed /new) or by
 *  session (the run's retargeted context). */
export function doSwapInto(slotPanelId: string, idx: number, request: PanelAddRequest): void {
	// Manager requests never REACH here (doReplacePanel handles the
	// manager successor-swap before the session ladder) — the guard is
	// defensive: a swap needs a successor session.
	if (
		request.kind === 'terminal' ||
		request.kind === 'prompt-manager' ||
		request.kind === 'settings-home' ||
		request.kind === 'injected-doc' ||
		request.kind === 'skill-shelf' ||
		request.kind === 'plugin-rack'
	)
		return; // defensive: a swap needs a successor session
	const panelId = slotPanelId;
	const placement = replaceTarget(st.panels, request.sessionId, d().getLineageFacts());
	if (placement.kind === 'plain') {
		const entry: DsiConversationPanel = {
			id: nextPanelId(),
			kind: 'conversation',
			sessionId: request.sessionId,
			agentPreset: request.agentPreset,
			width: st.panels[idx].width
		};
		if (request.focus === true) st.focusComposerId = entry.id;
		st.panels = st.panels.map((p, i) => (i === idx ? entry : p));
		st.selectedPanelId = entry.id;
		clearLoupeIfGone();
		void d().ensureCold(request.sessionId);
		return;
	}

	const { parentSessionId } = placement;
	const parentExisting = st.panels.find(
		(p) => p.kind === 'conversation' && p.sessionId === parentSessionId
	);
	if (parentExisting !== undefined && parentExisting.id === panelId) {
		// Replacing the spawner with its own child: keep the parent in
		// the slot (dedupe→pin), child splices below — never orphan the
		// family the replacement would create. Lineage-order slot: an
		// already-adopted older sibling keeps the new child below it.
		const child = makePanel(request.sessionId, request.agentPreset);
		if (request.focus === true) st.focusComposerId = child.id;
		const occupantSession = st.panels[idx].kind === 'conversation' ? st.panels[idx].sessionId : null;
		insertPanel(
			child,
			occupantSession !== null
				? pinnedSlotIndex(occupantSession, request.sessionId)
				: pinnedSlotIndex(parentSessionId, request.sessionId)
		);
		void d().ensureCold(request.sessionId);
		return;
	}
	// Free the addressed slot, then place the family: pinned (spawner
	// open → the lineage-order slot below it) or adopt-family (spawner
	// takes the freed slot, child below it).
	const freed = st.panels.filter((p) => p.id !== panelId);
	st.panels = freed;
	clearLoupeIfGone();
	if (placement.kind === 'pinned') {
		const child = makePanel(request.sessionId, request.agentPreset);
		if (request.focus === true) st.focusComposerId = child.id;
		insertPanel(child, pinnedSlotIndex(parentSessionId, request.sessionId));
	} else {
		insertPanel(makePanel(parentSessionId, null), Math.min(idx, st.panels.length));
		const parentIndex = st.panels.findIndex(
			(p) => p.kind === 'conversation' && p.sessionId === parentSessionId
		);
		const child = makePanel(request.sessionId, request.agentPreset);
		if (request.focus === true) st.focusComposerId = child.id;
		insertPanel(child, parentIndex + 1);
		void d().ensureCold(parentSessionId);
	}
	void d().ensureCold(request.sessionId);
}

