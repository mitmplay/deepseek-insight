<script lang="ts">
	/**
	 * SettingsSkillsPanel - The Skill Shelf (ADR 2026-09-20, D1/D5),
	 * recomposed in the manager chrome grammar (The Shelf Chrome ADR,
	 * D1-D4): the panel is the STATE OWNER and composes three
	 * presentational components - Toolbar (timestamp + cross-tab verbs),
	 * Header (install/uninstall pill + reload, install tab only), and
	 * Container (the scroll owner). The content owns its fetches
	 * (/api/skills/*); the panel never touches the engine.
	 *
	 * Tab scoping (D4): the install tab lists only uninstalled skills;
	 * the uninstall tab only installed ones, with the uninstall verb
	 * gated by the API's uninstallable set (Skill Shelf D5 stands).
	 * Selection is one set keyed by row number n - a selected id can
	 * only ever match the active tab's rows.
	 */
	import { onMount, untrack } from 'svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import SettingsSkillsToolbar from './SettingsSkillsToolbar.svelte';
	import SettingsSkillsContainer from './SettingsSkillsContainer.svelte';
	import SettingsSkillsTabgroup from './SettingsSkillsTabgroup.svelte';
	import SettingsSkillsSelfSection from './SettingsSkillsSelfSection.svelte';
	import { RotateCw, ChevronsDownUp, ChevronsUpDown, LoaderCircle, Check } from '@lucide/svelte';

	interface ShelfSkill {
		n: string;
		id: string;
		path: string;
		tier: string | null;
		installed: boolean;
		signed: boolean;
		installedFrom: string | null;
		overview: string | null;
	}
	interface ShelfSource {
		id: string;
		author: string;
		/** Author profile URL (SKR link) — null renders no author door. */
		authorUrl?: string | null;
		/** Collection version (repo package.json) — null renders no version tag. */
		version?: string | null;
		repo: string;
		skills: ShelfSkill[];
	}
	interface ShelfSnapshot {
		generatedAt: string;
		sources: ShelfSource[];
	}

	let snapshot = $state<ShelfSnapshot | null>(null);
	let uninstallable = $state<ReadonlySet<string>>(new Set());
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let selected = $state<ReadonlySet<string>>(new Set());
	let busy = $state(false);
	let note = $state<string | null>(null);
	let rescanNote = $state(false);
	// Reload button feedback (2026-09-22): idle icon while quiet, spinner
	// while the reload round-trips (it can take minutes on the live
	// registry), a check for 5s on success, then back to idle.
	let reloadState = $state<'idle' | 'loading' | 'done'>('idle');
	let reloadDoneTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(reloadDoneTimer));

	/** Idle is the ABSENCE on the persisted entry — emit null so the
	 *  floor clears the blob; loading/done land with their expiry. */
	function emitReload(state: 'loading' | 'done' | 'idle', doneAt?: number): void {
		emit(onreloadchange, state === 'idle' ? null : { state, doneAt });
	}
	function enterDone(): void {
		reloadState = 'done';
		emitReload('done', Date.now() + 5_000);
		clearTimeout(reloadDoneTimer);
		reloadDoneTimer = setTimeout(() => {
			reloadState = 'idle';
			emitReload('idle');
		}, 5_000);
	}

	// Hard-reload survival (the explorer-tab pattern): a persisted done
	// lives out only its REMAINING window; a persisted loading re-issues
	// the reload so the operator still gets the check when it lands.
	$effect(() => {
		// untrack: seed ONCE from the mount-time prop — the floor recreates
		// the initialReload object on every panels write, and re-seeding on
		// each write would reschedule the done timer forever.
		const seed = untrack(() => initialReload);
		if (!seed) return;
		untrack(() => {
			if (seed.state === 'done') {
				const remaining = Math.max(0, (seed.doneAt ?? 0) - Date.now());
				if (remaining === 0) return; // expired — stay idle
				reloadState = 'done';
				emitReload('done', seed.doneAt);
				clearTimeout(reloadDoneTimer);
				reloadDoneTimer = setTimeout(() => {
					reloadState = 'idle';
					emitReload('idle');
				}, remaining);
			} else if (seed.state === 'loading') {
				void runReload();
			}
		});
	});

	// The Shelf Chrome state (panel-owned, D1): active tab, collapsed
	// per-repo groups, the search text (toolbar box owns keystrokes).
	// Hard-reload survival: the FLOOR owns the persisted copies on the
	// panel entry (the explorer-tab pattern) — this component seeds from
	// the initial* props once and emits every change back; `collapsed`
	// stays null until the first snapshot seeds the ALL-COLLAPSED default
	// (or the restored set arrives through initialCollapsed).
	interface Props {
		initialTab?: 'install' | 'uninstall';
		initialCollapsed?: string[] | null;
		initialSearch?: string;
		/** Persisted reload feedback (hard-reload survival): a restored
		 *  'done' lives out its remaining 5s window; a restored 'loading'
		 *  re-issues the reload so the check still lands. */
		initialReload?: { state: 'loading' | 'done'; doneAt?: number } | null;
		ontabchange?: (tab: 'install' | 'uninstall') => void;
		oncollapsedchange?: (collapsed: string[]) => void;
		onsearchchange?: (q: string) => void;
		onreloadchange?: (r: { state: 'loading' | 'done'; doneAt?: number } | null) => void;
	}
	let {
		initialTab = 'install',
		initialCollapsed = null,
		initialSearch = '',
		initialReload = null,
		ontabchange,
		oncollapsedchange,
		onsearchchange,
		onreloadchange
	}: Props = $props();

	// svelte-ignore state_referenced_locally
	let tab = $state<'install' | 'uninstall'>(initialTab);
	let collapsed = $state<ReadonlySet<string> | null>(
		// svelte-ignore state_referenced_locally
		initialCollapsed === null ? null : new Set(initialCollapsed)
	);
	// svelte-ignore state_referenced_locally
	let searchQ = $state(initialSearch);
	let rootEl = $state<HTMLElement | null>(null);

	// Emit-side effects track ONLY the primitive state — the callbacks
	// are untracked because the floor recreates them on every panels
	// write (inline arrows), and tracking them loops emit→write→emit.
	function emit<T>(fn: ((value: T) => void) | undefined, value: T): void {
		untrack(() => fn?.(value));
	}
	$effect(() => {
		if (collapsed !== null) emit(oncollapsedchange, [...collapsed]);
	});
	$effect(() => emit(ontabchange, tab));
	$effect(() => emit(onsearchchange, searchQ));

	async function loadSnapshot(): Promise<void> {
		loading = true;
		loadError = null;
		try {
			const res = await fetch('/api/skills/snapshot');
			const body = await res.json();
			if (!body.ok) throw new Error(body.error ?? 'snapshot failed');
			snapshot = body.snapshot;
			uninstallable = new Set(body.uninstallable as string[]);
			// Default render is ALL COLLAPSED (2026-09-21): the operator
			// lands on a quiet shelf and expands the repo they want —
			// expand-all / group toggles take it from there. A restored
			// set (initialCollapsed) or an already-toggled session set
			// wins — the default only fills the first, unrestored load.
			if (collapsed === null) {
				collapsed = allCollapsedIds(snapshot);
			}
		} catch (e) {
			loadError = String((e as Error).message);
		} finally {
			loading = false;
		}
	}

	function toggle(id: string): void {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	/** The ALL-COLLAPSED default set — every source id in the snapshot.
	 *  The one expression behind the first-load seed, the group toggle's
	 *  null fallback, and the collapse-all verb. */
	function allCollapsedIds(snap: ShelfSnapshot | null): ReadonlySet<string> {
		return new Set(snap?.sources.map((s) => s.id) ?? []);
	}

	function toggleGroup(sourceId: string): void {
		const next = new Set(collapsed ?? allCollapsedIds(snapshot));
		if (next.has(sourceId)) next.delete(sourceId);
		else next.add(sourceId);
		collapsed = next;
	}

	function collapseAll(): void {
		collapsed = allCollapsedIds(snapshot);
	}

	function expandAll(): void {
		collapsed = new Set();
	}

	/** Null = not yet seeded (pre-snapshot) renders as the ALL-COLLAPSED
	 *  default; the first load (or the restored set) replaces it. */
	function groupHidden(sourceId: string): boolean {
		return collapsed?.has(sourceId) ?? true;
	}

	/** Rows of a source scoped to the active tab (D4) + search filter. */
	function visibleSkills(source: ShelfSource): ShelfSkill[] {
		const q = searchQ.trim().toLowerCase();
		return source.skills.filter((s) => {
			if (tab === 'install' ? s.installed : !s.installed) return false;
			if (q && !s.id.toLowerCase().includes(q) && !s.n.toLowerCase().includes(q)) return false;
			return true;
		});
	}

	const visibleSources = $derived(
		snapshot
			? snapshot.sources
					.map((s, i) => ({ source: s, index: i + 1, skills: visibleSkills(s) }))
					.filter((g) => g.skills.length > 0)
			: []
	);

	/** Selection counts, per tab (the pill's interpolated labels, D3). */
	const installCount = $derived(
		snapshot
			? snapshot.sources
					.flatMap((s) => s.skills)
					.filter((s) => !s.installed && selected.has(s.n)).length
			: 0
	);

	async function runInstall(): Promise<void> {
		if (installCount === 0 || busy) return;
		busy = true;
		note = null;
		try {
			const res = await fetch('/api/skills/install', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ targets: [...selected] })
			});
			const body = await res.json();
			note = body.ok ? null : (body.error ?? 'install reported failures');
			if (body.ok) rescanNote = true;
			selected = new Set();
			await loadSnapshot();
		} catch (e) {
			note = String((e as Error).message);
		} finally {
			busy = false;
		}
	}

	async function runUninstall(id: string): Promise<void> {
		if (busy) return;
		busy = true;
		note = null;
		try {
			const res = await fetch('/api/skills/uninstall', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ids: [id] })
			});
			if (res.status === 409) note = t(m.skillsShelfUnsignedRefusal);
			await loadSnapshot();
		} catch (e) {
			note = String((e as Error).message);
		} finally {
			busy = false;
		}
	}

	async function runReload(): Promise<void> {
		if (busy || reloadState === 'loading') return;
		busy = true;
		reloadState = 'loading';
		emitReload('loading');
		note = null;
		try {
			const res = await fetch('/api/skills/reload', { method: 'POST' });
			const body = await res.json();
			if (!body.ok) throw new Error(body.error ?? 'reload failed');
			snapshot = body.snapshot;
			uninstallable = new Set(body.uninstallable as string[]);
			enterDone();
		} catch (e) {
			note = String((e as Error).message);
			reloadState = 'idle';
			emitReload('idle');
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		void loadSnapshot();
	});
</script>

<div class="skill-shelf" bind:this={rootEl} data-testid="skill-shelf">
	<SettingsSkillsToolbar
		generatedAt={snapshot?.generatedAt ?? ''}
		bind:searchQ
		container={rootEl}
		oncollapseall={collapseAll}
		onexpandall={expandAll}
	/>

	<div class="shelf-header" data-testid="shelf-header">
		<SettingsSkillsTabgroup tab={tab} ontabchange={(v) => (tab = v)} />
		<div class="shelf-header-actions">
			{#if tab === 'install'}
				<button
					type="button"
					class="shelf-reload"
					class:reloading={reloadState === 'loading'}
					class:reloaded={reloadState === 'done'}
					data-testid="shelf-reload"
					data-reload-state={reloadState}
					title={reloadState === 'loading' ? t(m.skillsShelfReloading) : reloadState === 'done' ? t(m.skillsShelfReloaded) : t(m.skillsShelfReload)}
					aria-label={reloadState === 'loading' ? t(m.skillsShelfReloading) : reloadState === 'done' ? t(m.skillsShelfReloaded) : t(m.skillsShelfReload)}
					onclick={runReload}
					disabled={busy}
				>
					{#if reloadState === 'loading'}<LoaderCircle size={13} aria-hidden="true" />{:else if reloadState === 'done'}<Check size={13} aria-hidden="true" />{:else}<RotateCw size={13} aria-hidden="true" />{/if}
				</button>
			{/if}
			<!-- The lineage-fold pill grammar (SidebarOpenPanelTree): ONE
			     joined pill, icon-only segments, i18n tooltip + aria-label.
			     Cross-tab by contract (ADR D2) — sits AFTER the reload verb. -->
			<div class="seg-group" role="group" aria-label={t(m.skillsShelfTitle)} data-testid="shelf-fold-toggle">
				<button
					type="button"
					class="seg left"
					aria-label={t(m.skillsShelfCollapseAll)}
					title={t(m.skillsShelfCollapseAll)}
					data-testid="shelf-collapse-all"
					onclick={collapseAll}
				>
					<ChevronsDownUp size={12} aria-hidden="true" />
				</button>
				<button
					type="button"
					class="seg right"
					aria-label={t(m.skillsShelfExpandAll)}
					title={t(m.skillsShelfExpandAll)}
					data-testid="shelf-expand-all"
					onclick={expandAll}
				>
					<ChevronsUpDown size={12} aria-hidden="true" />
				</button>
			</div>
		</div>
	</div>

	{#if loading}
		<p class="shelf-note" data-testid="shelf-loading">{t(m.skillsShelfLoading)}</p>
	{:else if loadError}
		<p class="shelf-note shelf-error" data-testid="shelf-error">{loadError}</p>
	{:else if snapshot}
		{#if rescanNote}<p class="shelf-note" data-testid="shelf-rescan">{t(m.skillsShelfRescan)}</p>{/if}
		{#if note}<p class="shelf-note shelf-error" data-testid="shelf-note">{note}</p>{/if}
		{#each snapshot.warnings ?? [] as w (w.code + w.source)}
			<p class="shelf-note shelf-warn" data-testid={'shelf-warn-' + w.source}>{w.detail}</p>
		{/each}
		<SettingsSkillsContainer>
			{#each visibleSources as g (g.source.id)}
				<SettingsSkillsSelfSection
					sourceId={g.source.id}
					index={g.index}
					author={g.source.author}
					authorUrl={g.source.authorUrl ?? null}
					version={g.source.version ?? null}
					repoUrl={g.source.repo}
					skills={g.skills}
					hidden={groupHidden(g.source.id)}
					selected={selected}
					uninstallable={uninstallable}
					{tab}
					{busy}
					ontoggle={(n) => toggle(n)}
					ontogglegroup={() => toggleGroup(g.source.id)}
					onuninstall={(id) => runUninstall(id)}
				/>
			{/each}
			{#if visibleSources.length === 0}
				<p class="shelf-note" data-testid="shelf-empty">—</p>
			{/if}
		</SettingsSkillsContainer>
		{#if tab === 'install'}
			<div class="shelf-install-bar">
				<button type="button" class="shelf-install" data-testid="shelf-install" onclick={runInstall} disabled={busy || installCount === 0}>
					{t(m.skillsShelfInstall)} ({installCount})
				</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.skill-shelf {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		height: 100%;
		font-size: 0.85rem;
	}
	.shelf-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
	}
	.shelf-header-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}
	.shelf-reload {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem 0.35rem;
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		background: transparent;
		cursor: pointer;
	}
	.shelf-reload:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	/* Reload feedback: spinner rotates while the reload round-trips; the
	   check flashes green for the 5s done window. */
	.shelf-reload.reloading {
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 55%, #1e3a8a);
	}
	.shelf-reload.reloading :global(svg) {
		animation: shelf-reload-spin 1s linear infinite;
	}
	.shelf-reload.reloaded {
		color: #1a7f37;
		border-color: #1a7f37;
	}
	@keyframes shelf-reload-spin {
		to {
			transform: rotate(360deg);
		}
	}
	/* The fold pill — SidebarOpenPanelTree's seg-group contract: ONE
	   joined pill, zero gap, outer 9999px curves, icon-only segments;
	   rest #52606d, hover accent-deep navy. */
	.seg-group {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
	}
	.seg {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, #fff);
		background: transparent;
		color: #52606d;
		line-height: 1;
		padding: 0.15rem 0.275rem;
		cursor: pointer;
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.seg :global(svg) {
		display: block;
	}
	.seg.left {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		border-top-left-radius: 9999px;
		border-bottom-left-radius: 9999px;
	}
	.seg.right {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
		border-top-right-radius: 9999px;
		border-bottom-right-radius: 9999px;
		border-left-width: 0;
	}
	.seg:not(:disabled):hover {
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 12%, #fff);
	}
	.seg:focus-visible {
		outline: 2px solid #1e3a8a;
		outline-offset: -2px;
	}
	.shelf-note {
		color: var(--text-muted, #888);
		margin: 0;
		padding: 0 0.5rem;
	}
	.shelf-error {
		color: #e74c3c;
	}
	.shelf-warn {
		color: #b45309;
	}
	.shelf-install-bar {
		position: sticky;
		bottom: 0;
		padding: 0.5rem;
		background: var(--panel-bg, inherit);
	}
	/* The NewChatButton pastel-blue identity: the app's blue accent as
	   a pastel field with the navy-deepened text/border grammar; hover
	   deepens field and text together. */
	.shelf-install {
		width: 100%;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		border-radius: 0.375rem;
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 15%, #fff);
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease;
	}
	.shelf-install:not(:disabled):hover {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 22%, #fff);
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 65%, #1e3a8a);
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 55%, #1e3a8a);
	}
	.shelf-install:disabled {
		cursor: default;
		opacity: 0.6;
	}
</style>
