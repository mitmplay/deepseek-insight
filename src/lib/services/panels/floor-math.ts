/**
 * floor-math.ts — the drag/resize/order math, moved verbatim from the
 * route's module script (KB "The Floor Decomposition" E3, 2026-09-06).
 * PURE functions, exported so tests/unit/panel-resize.test.ts pins
 * conservation/clamps/ratios without a browser. The ROUTE is still the
 * single drag owner (S4): gutters report (event, index) via the registry;
 * these helpers are the algorithms it runs. All width math routes through
 * clampPanelWidth from panel-prefs (the one clamp site, commitment 3).
 */
import type { DsiPanelEntry } from '$lib/types';
import { clampPanelWidth } from '$lib/utils/panel-prefs';
import type { PanelMoveDir } from './panel-registry';

/** Plain drag (individual, 2026-08-28): ONLY the panel left of the dragged
 *  gutter changes — its snapshot width plus delta, clamped to the panel
 *  bounds. Other panels keep their widths untouched (the row's total
 *  grows/shrinks; the floor viewport scrolls when the widened row
 *  overflows it). Replaces the old pair-conserved steal (ADR-0006's OCI
 *  parity) on operator call: resizing one panel must not move another
 *  panel's value. */
export function resizeOne(
	panels: readonly DsiPanelEntry[],
	snapshots: readonly number[],
	index: number,
	delta: number
): DsiPanelEntry[] {
	const target = clampPanelWidth(snapshots[index] + delta, panels[index]?.kind);
	return panels.map((p, i) => (i === index ? { ...p, width: target } : p));
}

/** Shift+drag: EVERY panel scales by its snapshot share of the row —
 *  ratios are preserved (new_i/new_j = snap_i/snap_j until a panel
 *  saturates at a bound; an extreme drag clamps the row). Zoom-drag
 *  deltas are unscaled screen px (documented quirk, ADR-0006 R8). */
export function scaleProportionally(
	panels: readonly DsiPanelEntry[],
	snapshots: readonly number[],
	delta: number
): DsiPanelEntry[] {
	const total = snapshots.reduce((sum, w) => sum + w, 0);
	if (total <= 0) return [...panels];
	return panels.map((p, i) => ({
		...p,
		width: clampPanelWidth(snapshots[i] + (snapshots[i] / total) * delta, panels[i]?.kind)
	}));
}

/** Honest-slider check: a row is uniform when every width equals the
 *  first (an empty row is not — nothing to sync the preset to). */
export function isUniformRow(panels: readonly DsiPanelEntry[]): boolean {
	if (panels.length === 0) return false;
	const first = panels[0].width;
	return panels.every((p) => p.width === first);
}

/** Move one panel one slot toward the direction's edge — 'left'/'up' swap
 *  with the predecessor, 'right'/'down' with the successor (the invoking
 *  surface's geometry: header chevrons horizontal, sidebar rows vertical
 *  — the same array operation). A no-op returning the input order at
 *  either edge or for an unknown panel id. Selection needs no repair
 *  here: it is keyed by panel id, so the active panel travels with the
 *  swap — [a,b,c] active a, move a right → [b,a,c] active a, now middle. */
export function movePanelWithin(
	panels: readonly DsiPanelEntry[],
	panelId: string,
	dir: PanelMoveDir
): DsiPanelEntry[] {
	const idx = panels.findIndex((p) => p.id === panelId);
	if (idx === -1) return [...panels];
	const target = dir === 'left' || dir === 'up' ? idx - 1 : idx + 1;
	if (target < 0 || target >= panels.length) return [...panels];
	const next = [...panels];
	[next[idx], next[target]] = [next[target], next[idx]];
	return next;
}
