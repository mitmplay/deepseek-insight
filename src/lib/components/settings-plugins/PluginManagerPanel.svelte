<script lang="ts">
	/**
	 * PluginManagerPanel — The Plugin Rack (ADR 2026-09-27, D1): the
	 * panel is the STATE OWNER and owns its fetches (/api/plugins/*);
	 * it never touches the engine or dsh. One list, per-row verb: an
	 * uninstalled row offers install, an installed row offers uninstall
	 * (the manifest is the uninstall authority, D4 — the snapshot's
	 * installed flag is the API's derived copy). A successful apply ends
	 * with the DSH restart chain: the floor goes down and re-attaches on
	 * the same URL (D5) — the banner says so BEFORE the fetch storms.
	 */
	import { onMount } from 'svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { Check, ChevronDown, ChevronRight, LoaderCircle, Star } from '@lucide/svelte';
	import PluginManagerRackRow from './PluginManagerRackRow.svelte';
	import PluginManagerHeader from './PluginManagerHeader.svelte';
	import PluginManagerToolbar from './PluginManagerToolbar.svelte';
	import PluginManagerUninstall from './PluginManagerUninstall.svelte';
	import PluginManagerInstall from './PluginManagerInstall.svelte';
	import PluginManagerStars from './PluginManagerStars.svelte';

	interface Props {
		/** Session-only refresh token (BUG 2026-10-05, same contract as the
		 *  shelf's): the floor bumps it on /dsi-plugins --reload dedupe so
		 *  the open rack re-fetches the rebuilt snapshot. */
		refreshToken?: number;
		/** Persisted chrome (the explorer-tab pattern): the active pill tab.
		 *  Junk sanitizes to 'install'. */
		initialTab?: 'install' | 'uninstall';
		/** Reports the active tab up to the panel entry (hard-reload survival). */
		ontabchange?: (tab: 'install' | 'uninstall') => void;
	}
	let { refreshToken = 0, initialTab = 'install', ontabchange }: Props = $props();

	interface RackPlugin {
		n: string;
		id: string;
		group?: 'owned' | 'external'; // v2 wire: owned = plugins/ scan, external = reff
		description?: string | null;
		version?: string | null;
		dn?: string; // display number, e.g. 1.1 (source number . row number)
		authorUrl?: string | null;
		repo: string;
		author: string | null;
		installed: boolean;
	}
	interface RackSource {
		n?: string;
		name?: string;
		id: string;
		author: string | null;
		repo: string;
		plugins: RackPlugin[];
	}
	interface RackSnapshot {
		generatedAt: string;
		profile: string;
		sources?: RackSource[]; // v2: grouped by repository (Shelf Chrome grammar)
		plugins: RackPlugin[]; // flat derived copy (v1 back-compat)
	}
	interface ErrorRow {
		id: string;
		error: string;
	}

	let snapshot = $state<RackSnapshot | null>(null);
	let loadFailed = $state(false);
	let loading = $state(true);
	let busyId = $state<string | null>(null);
	let floorBounce = $state(false);
	let errors = $state<ErrorRow[]>([]);
	// GitHub stargazers per plugin id — the snapshot/reload responses carry
	// them best-effort; an absent fetch simply leaves the badge off the row.
	let stars = $state<Record<string, number>>({});
	// The shelf's tab grammar (Shelf Chrome ADR): install lists uninstalled
	// plugins, uninstall lists installed ones - a successful apply MOVES the
	// row (the post-apply load() refetch flips the installed flag).
	// Sanitize through a value expression: junk falls to 'install', and the
	// direct prop reference would trip svelte's state_referenced_locally warn.
	// svelte-ignore state_referenced_locally -- intentional one-time init; later changes to initialTab must not move the tab.
	let tab = $state<'install' | 'uninstall'>(initialTab === 'uninstall' ? 'uninstall' : 'install');
	function setTab(next: 'install' | 'uninstall'): void {
		tab = next;
		ontabchange?.(next);
	}
	// The bounce wait (D5 answers-first): the server is DOWN while the chain
	// re-serves, so the poll expects failures and polls through them until a
	// snapshot answers again — then load() refreshes the panel by itself. No
	// operator hard-reload.
	const BOUNCE_POLL_MS = 1500;
	const BOUNCE_TIMEOUT_MS = 120_000;
	let searchQ = $state('');
	let rootEl = $state<HTMLElement | null>(null);
	let visiblePlugins = $derived.by(() => {
		const rows = snapshot?.plugins.filter((p) => (tab === 'install' ? !p.installed : p.installed)) ?? [];
		const q = searchQ.trim().toLowerCase();
		if (!q) return rows;
		// The needle searches the row's identity: display name, id, repo, author.
		return rows.filter((p) =>
			[p.n, p.id, p.repo, p.author ?? ''].some((s) => s.toLowerCase().includes(q))
		);
	});

	/** Poll through the bounce: the floor answers failures until the chain
	 *  has re-served, then one snapshot success ends the wait. False on
	 *  timeout (the banner gives way to the retry UI; polling never hangs). */
	async function waitFloorBack(): Promise<boolean> {
		const deadline = Date.now() + BOUNCE_TIMEOUT_MS;
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, BOUNCE_POLL_MS));
			try {
				const res = await fetch('/api/plugins/snapshot', { cache: 'no-store' });
				if (res.ok) return true;
			} catch {
				// floor still down — keep polling
			}
		}
		return false;
	}

	async function load(): Promise<void> {
		loading = true;
		loadFailed = false;
		try {
			const res = await fetch('/api/plugins/snapshot');
			const body = await res.json();
			if (body.ok) {
				snapshot = body.snapshot;
				stars = body.stars ?? {};
			} else loadFailed = true;
		} catch {
			loadFailed = true;
		} finally {
			loading = false;
		}
	}

	// The header's reload verb is a REBUILD, not a re-read (RCA 2026-09-27:
	// wired to load() it only re-fetched the cached snapshot — the button
	// looked dead because a cached GET cannot change). POST --reload asks
	// the engine to re-take the snapshot (fresh numbering + manifest-
	// reconciled installed flags) and the body carries it directly.
	async function runReload(): Promise<void> {
		if (loading || floorBounce) return;
		loading = true;
		loadFailed = false;
		errors = [];
		try {
			const res = await fetch('/api/plugins/reload', { method: 'POST' });
			const body = await res.json();
			if (body.ok && body.snapshot) {
				snapshot = body.snapshot;
				stars = body.stars ?? {};
			} else loadFailed = true;
		} catch {
			loadFailed = true;
		} finally {
			loading = false;
		}
	}

	async function apply(action: 'install' | 'remove', id: string): Promise<void> {
		busyId = id;
		errors = [];
		try {
			const res = await fetch('/api/plugins/apply', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action, targets: [id] })
			});
			const body = await res.json();
			if (body.ok && body.restarting) {
				// D5: the chain kills this very server — say so, then ride the
				// bounce out: when the floor answers again the panel refreshes
				// ITSELF (no operator hard-reload).
				floorBounce = true;
				busyId = null;
				void waitFloorBack().then(async (back) => {
					if (back) await load();
					else loadFailed = true;
					floorBounce = false;
				});
				return;
			}
			if (!body.ok) {
				errors = (body.results ?? [])
					.filter((r: { ok: boolean }) => !r.ok)
					.map((r: { id?: string; n?: string; error?: string }) => ({ id: r.id ?? id, error: r.error ?? '' }));
			} else {
				await load();
			}
		} catch {
			errors = [{ id, error: 'network' }];
		} finally {
			busyId = null;
		}
	}

	// The --reload-on-open-rack contract (BUG 2026-10-05): the floor bumps
	// refreshToken after the server-side rebuild; the FIRST value is the
	// mount itself (load in onMount), every CHANGE re-fetches.
	// svelte-ignore state_referenced_locally -- intentional: the seed is the
	// mount-time value; only later CHANGES re-fetch.
	let lastRefreshToken = refreshToken;
	$effect(() => {
		if (refreshToken !== lastRefreshToken) {
			lastRefreshToken = refreshToken;
			void load();
		}
	});


	// Shelf selection grammar (3.3): one Set keyed by row n; the bottom bar
	// applies ALL selected rows in ONE POST, then clears and reloads.
	let selected = $state<ReadonlySet<string>>(new Set());
	// Shelf Chrome: sources ship COLLAPSED; the chevron or the expand-all
	// verb opens one repo's rows.
	let collapsedGroups = $state<ReadonlySet<string>>(new Set());
	const visibleSources = $derived.by(() => {
		const q = searchQ.trim().toLowerCase();
		let rows = snapshot?.plugins ?? [];
		rows = rows.filter((p) => (tab === 'install' ? !p.installed : p.installed));
		if (q) rows = rows.filter((p) => [p.n, p.id, p.repo, p.author ?? '', p.description ?? ''].some((x) => x.toLowerCase().includes(q)));
		const srcs = snapshot?.sources ?? [];
		if (srcs.length > 0) {
			// v2 wire: sources are authoritative; filter their rows by the tab/search.
			return srcs
				.map((src, si) => ({
					...src,
					n: String(si + 1),
					plugins: rows.filter((p) => src.plugins.some((sp) => sp.n === p.n)).map((p, ri) => ({ ...p, dn: (si + 1) + '.' + (ri + 1) }))
				}))
				.filter((src) => src.plugins.length > 0);
		}
		// v1 back-compat: group the flat rows by repo tail (Plugin Garden ADR, D1).
		const groups = new Map<string, { id: string; n: string; name?: string; author: string | null; repo: string; plugins: RackPlugin[] }>();
		for (const p of rows) {
			const tail = p.repo.replace(/\.git$/, '').replace(/\/+$/, '').split('/').slice(-2).join('/');
			const gid = tail || p.repo;
			if (!groups.has(gid)) groups.set(gid, { id: gid, n: String(groups.size + 1), name: gid.split('/').pop(), author: p.author ?? null, repo: p.repo, plugins: [] });
			groups.get(gid)!.plugins.push(p);
		}
		return [...groups.values()];
	});
	function toggleGroup(id: string): void {
		const next = new Set(collapsedGroups);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		collapsedGroups = next;
	}
	function collapseAll(): void {
		collapsedGroups = new Set(visibleSources.map((src) => src.id));
	}
	function expandAll(): void {
		collapsedGroups = new Set();
	}
	const installCount = $derived(
		visibleSources.flatMap((src) => src.plugins).filter((p) => !p.installed && selected.has(p.n)).length
	);
	function toggleSelect(n: string): void {
		const next = new Set(selected);
		if (next.has(n)) next.delete(n);
		else next.add(n);
		selected = next;
	}
	async function runInstall(): Promise<void> {
		if (installCount === 0 || floorBounce) return;
		const targets = [...selected];
		const idByN = new Map(visibleSources.flatMap((src) => src.plugins).filter((p) => selected.has(p.n)).map((p) => [p.n, p.id]));
		busyId = targets[0] ?? null;
		errors = [];
		try {
			const res = await fetch('/api/plugins/apply', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'install', targets })
			});
			const body = await res.json();
			if (body.ok && body.restarting) {
				// D5: the chain kills this very server — announce the bounce, ride
				// it out, and let the panel refresh ITSELF when the floor returns.
				floorBounce = true;
				busyId = null;
				selected = new Set();
				void waitFloorBack().then(async (back) => {
					if (back) await load();
					else loadFailed = true;
					floorBounce = false;
				});
				return;
			}
			if (!body.ok) {
				const results = body.results ?? [];
				errors = results.length
					? results
							.filter((r: { ok: boolean }) => !r.ok)
							.map((r: { id?: string; n?: string; error?: string }) => ({ id: r.id ?? idByN.get(String(r.n)) ?? targets[0], error: r.error ?? '' }))
					: [{ id: idByN.get(targets[0]) ?? targets[0], error: '' }];
				selected = new Set();
			} else {
				selected = new Set();
				await load();
			}
		} catch {
			errors = targets.map((n) => ({ id: idByN.get(n) ?? n, error: 'network' }));
		} finally {
			busyId = null;
		}
	}

	onMount(() => {
		void load();
	});
</script>

<div class="rack" bind:this={rootEl} data-testid="rack-body">
	<PluginManagerToolbar generatedAt={snapshot?.generatedAt ?? ''} bind:searchQ container={rootEl} />
	<PluginManagerHeader {tab} {loading} {floorBounce} ontabchange={setTab} onreload={() => void runReload()} oncollapseall={collapseAll} onexpandall={expandAll} />

		{#if floorBounce}
			<div class="rack-banner" data-testid="rack-bounce" role="status">{t(m.pluginRackApplying)}</div>
		{:else if loading}
			<div class="rack-note"><span class="spin"><LoaderCircle size={14} /></span></div>
		{:else if loadFailed || !snapshot}
			<div class="rack-note" data-testid="rack-load-failed">
				{t(m.pluginRackLoadFailed)}
				<button type="button" onclick={() => void load()}>{t(m.pluginRackRetry)}</button>
			</div>
		{:else if snapshot.plugins?.length === 0}
			<div class="rack-note" data-testid="rack-empty">{t(m.pluginRackEmpty)}</div>
		{:else if visibleSources.length === 0}
			<div class="rack-note" data-testid="rack-tab-empty">
				{tab === 'install' ? t(m.pluginRackInstallEmpty) : t(m.pluginRackUninstallEmpty)}
			</div>
		{:else}
			{#each visibleSources as source (source.id + source.repo)}
				<div class="rack-source" data-testid={'rack-source-' + source.id.replace(/[^a-zA-Z0-9-]/g, '-')}>
					<button
						type="button"
						class="rack-source-head"
						data-testid={'rack-source-head-' + source.id.replace(/[^a-zA-Z0-9-]/g, '-')}
						aria-expanded={collapsedGroups.has(source.id) ? 'false' : 'true'}
						onclick={() => toggleGroup(source.id)}
					>
						<span class="rack-source-chevron">{#if collapsedGroups.has(source.id)}<ChevronRight size={12} aria-hidden="true" />{:else}<ChevronDown size={12} aria-hidden="true" />{/if}</span>
						<span class="rack-source-num">{source.n}.</span>
						{#if source.author}
						<span class="rack-source-author">by {source.author}</span>
						{:else}
						<span class="rack-source-name">{source.name ?? source.id}</span>
						{/if}
						<PluginManagerStars id={source.id} repo={source.repo} author={source.author} plugins={source.plugins} stars={stars} />
					</button>
					{#if !collapsedGroups.has(source.id)}
						<ul class="rack-rows" data-testid={'rack-rows-' + source.id.replace(/[^a-zA-Z0-9-]/g, '-')}>
							{#each source.plugins as plugin (plugin.n)}
								<li class="rack-row" class:rack-row-selected={selected.has(plugin.n)} data-testid={'rack-row-' + plugin.id}>
									{#if tab === 'install' && !plugin.installed}
										<input
											type="checkbox"
											class="rack-check"
											data-testid={'rack-select-' + plugin.n}
											checked={selected.has(plugin.n)}
											onchange={() => toggleSelect(plugin.n)}
										/>
									{/if}
									<span class="rack-n">{plugin.dn}</span>
									<span class="rack-id">
										{plugin.id}
										{#if plugin.installed}
											<span class="rack-badge" data-testid={'rack-badge-' + plugin.id} role="status" aria-label={t(m.pluginRackInstalled)}>
												<Check size={11} aria-hidden="true" /> {t(m.pluginRackInstalled)}
											</span>
										{/if}
									</span>
									{#if plugin.description}
										<span class="rack-desc">{plugin.description}</span>
									{/if}
									<PluginManagerUninstall {plugin} {busyId} {floorBounce} onremove={(id) => void apply('remove', id)} />
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
			{#if errors.length > 0}
				<ul class="rack-errors" data-testid="rack-errors">
					{#each errors as e (e.id)}
						<li class="rack-error">{e.id}: {e.error}</li>
					{/each}
				</ul>
			{/if}
			{#if tab === 'install'}<PluginManagerInstall count={installCount} {floorBounce} oninstall={() => void runInstall()} />{/if}
		{/if}
</div>
<style>
	.rack {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		height: 100%;
		box-sizing: border-box;
		gap: 0.25rem;
		font-size: 0.85rem;
		padding-bottom: 3.2rem;
	}
	.rack-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
		border-bottom: 1px solid var(--color-surface-border, #dee2e6);
	}
	.rack-generated-label {
		font-size: 0.6875rem;
		color: var(--color-text-muted, #888);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.rack-toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex: 1;
		min-width: 0;
	}
	.rack-search {
		flex: 1;
		min-width: 6rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		background: var(--color-surface, #f8f9fa);
		font-size: 0.6875rem;
		padding: 0.15rem 0.35rem;
	}
	.rack-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
	}
	.rack-source {
		display: flex;
		flex-direction: column;
	}
	.rack-source-head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
		width: 100%;
		background: none;
		border: 0;
		padding: 0.15rem 0.3rem;
		cursor: pointer;
		color: inherit;
		font-weight: 600;
		text-align: left;
	}
	.rack-source-head:hover {
		background: color-mix(in srgb, currentcolor 6%, transparent);
	}
	.rack-source-chevron {
		display: inline-flex;
		align-items: center;
	}
	.rack-source-chevron :global(svg) {
		display: block;
	}
	.rack-source-num {
		opacity: 0.55;
		font-variant-numeric: tabular-nums;
		padding-right: 0.15rem;
	}
	.rack-source-name {
		display: inline;
	}
	.rack-source-author {
		display: inline;
		font-weight: 400;
		opacity: 0.75;
	}
	.rack-rows {
		list-style: none;
		margin: 0;
		padding: 0 0 0 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.rack-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.12rem 0.4rem;
		border-radius: 6px;
	}
	.rack-row:hover {
		background: color-mix(in srgb, currentcolor 6%, transparent);
	}
	.rack-row-selected,
	.rack-row:has(.rack-check:checked) {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 10%, transparent);
	}
	.rack-check {
		appearance: none;
		width: 0.9rem;
		height: 0.9rem;
		margin: 0;
		border: 1.5px solid var(--color-surface-border, #8b949e);
		border-radius: 3px;
		background: var(--color-surface, #fff);
		cursor: pointer;
		flex-shrink: 0;
		display: inline-block;
		vertical-align: middle;
	}
	.rack-check:checked {
		background: var(--color-accent-blue, #3b82f6);
		border-color: var(--color-accent-blue, #3b82f6);
		box-shadow: inset 0 0 0 2px var(--color-surface, #fff);
	}
	.rack-n {
		opacity: 0.55;
		font-variant-numeric: tabular-nums;
		padding-right: 0.15rem;
	}
	.rack-id {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
	}
	.rack-desc {
		color: var(--color-text-muted, #888);
		font-size: 0.78rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}
	.rack-author {
		opacity: 0.75;
	}
	.rack-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		padding: 0.05rem 0.3rem;
		border-radius: 999px;
		background: color-mix(in srgb, #1a7f37 14%, transparent);
		color: #1a7f37;
		font-size: 0.68rem;
	}
	.rack-group-head {
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted, #888);
		font-size: 0.72rem;
		font-weight: 600;
		margin-top: 0.5rem;
	}
	.rack-note {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		opacity: 0.75;
		padding: 0.25rem 0.5rem;
	}
	.rack-banner {
		padding: 0.5rem 0.6rem;
		border-radius: 6px;
		background: color-mix(in srgb, orange 18%, transparent);
	}
	.rack-errors {
		list-style: none;
		margin: 0;
		padding: 0.4rem 0.5rem;
		border-radius: 6px;
		background: color-mix(in srgb, red 12%, transparent);
		font-size: 0.75rem;
		overflow-wrap: anywhere;
	}
	.rack-collapse {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: 0;
		padding: 0.25rem;
		cursor: pointer;
		color: inherit;
		border-radius: 0.25rem;
	}
	.spin {
		display: inline-flex;
		animation: rack-spin 1s linear infinite;
	}
	@keyframes rack-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
