/**
 * Page prefs — the workspace route's layout state, service-owned
 * (ADR-0018 D2/D4 wave 2; spec "Component Standard Enforcement" 2.1).
 *
 * SINGLETON by design: one page load = one desk. Owns the numbers that
 * were inline `$state` in `src/routes/+page.svelte` (the prefs block
 * and the sidebar block) so the route's remaining script is floor
 * ownership, not storage plumbing.
 *
 * Persistence split (honest, not hidden):
 * - sidebar prefs: fully owned here — `installSidebarAutoSave()` (call
 *   during component init; the `$effect` needs an owner context).
 * - the FLOOR blob stays persisted by the route's one R2 effect: it
 *   mixes these fields with `panels`/`selectedPanelId`/`terminalDeskMirrors`
 *   which remain floor-owned. The service only owns the numbers.
 */
import { clampPanelWidth, clampPanelZoom, clampTreePct, loadPanelPrefs } from '$lib/utils/panel-prefs';
import { loadSidebarPrefs, saveSidebarPrefs } from '$lib/utils/sidebar-prefs';

class PagePrefs {
	/** Width preset for the next conversation panel (clamped). */
	panelWidth = $state(0);
	/** Floor zoom (clamped). */
	zoom = $state(1);
	/** Explorer Layout split (clamped). */
	treePct = $state(0);
	/** Sidebar rail state (OCI ControlRail port). */
	sidebarCollapsed = $state(false);
	sidebarWidth = $state(0);

	#profile: string | null = null;
	#initialised = false;

	/** Seed every field from the persisted blobs — exactly once, BEFORE
	 *  the route reads any field (makePanel reads panelWidth during the
	 *  seed reset). Intentional initial capture per the route's old
	 *  "svelte-ignore state_referenced_locally" comments: prefs seed the
	 *  layout once; later writes go through the save effects. */
	init(profile: string | null): void {
		// One MOUNT = one desk: the route's old inline $state seeded from
		// localStorage on every component init (a fresh page load each
		// time), so init always re-seeds — the singleton exists to share
		// the values with the route's save effect, not to dedupe loads.
		this.#initialised = true;
		this.#profile = profile;
		const floor = loadPanelPrefs(profile);
		this.panelWidth = clampPanelWidth(floor.panelWidth);
		this.zoom = clampPanelZoom(floor.zoom);
		this.treePct = clampTreePct(floor.treePct);
		const sidebar = loadSidebarPrefs(profile);
		this.sidebarCollapsed = sidebar.collapsed;
		this.sidebarWidth = sidebar.width;
	}

	get profile(): string | null {
		return this.#profile;
	}

	/** Sidebar persistence (the route's old sidebar save effect). Call
	 *  during component initialisation — `$effect` needs an owner. */
	installSidebarAutoSave(): void {
		$effect(() => {
			saveSidebarPrefs(
				{ collapsed: this.sidebarCollapsed, width: this.sidebarWidth },
				this.#profile
			);
		});
	}
}

export const pagePrefs = new PagePrefs();
