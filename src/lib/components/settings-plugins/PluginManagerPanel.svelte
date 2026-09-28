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
	import { LoaderCircle } from '@lucide/svelte';
	import PluginManagerRackRow from './PluginManagerRackRow.svelte';
	import PluginManagerHeader from './PluginManagerHeader.svelte';
	import PluginManagerToolbar from './PluginManagerToolbar.svelte';

	interface Props {
		/** Persisted chrome (the explorer-tab pattern): the active pill tab.
		 *  Junk sanitizes to 'install'. */
		initialTab?: 'install' | 'uninstall';
		/** Reports the active tab up to the panel entry (hard-reload survival). */
		ontabchange?: (tab: 'install' | 'uninstall') => void;
	}
	let { initialTab = 'install', ontabchange }: Props = $props();

	interface RackPlugin {
		n: string;
		id: string;
		repo: string;
		author: string | null;
		installed: boolean;
	}
	interface RackSnapshot {
		generatedAt: string;
		profile: string;
		plugins: RackPlugin[];
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
					.map((r: { id?: string; error?: string }) => ({ id: r.id ?? id, error: r.error ?? '' }));
			} else {
				await load();
			}
		} catch {
			errors = [{ id, error: 'network' }];
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
	<PluginManagerHeader {tab} {loading} {floorBounce} ontabchange={setTab} onreload={() => void runReload()} />

	{#if floorBounce}
		<div class="rack-banner" data-testid="rack-bounce" role="status">{t(m.pluginRackApplying)}</div>
	{:else if loading}
		<div class="rack-note"><span class="spin"><LoaderCircle size={14} /></span></div>
	{:else if loadFailed || !snapshot}
		<div class="rack-note" data-testid="rack-load-failed">
			{t(m.pluginRackLoadFailed)}
			<button type="button" onclick={() => void load()}>{t(m.pluginRackRetry)}</button>
		</div>
	{:else if snapshot.plugins.length === 0}
		<div class="rack-note" data-testid="rack-empty">{t(m.pluginRackEmpty)}</div>
	{:else if visiblePlugins.length === 0}
		<div class="rack-note" data-testid="rack-tab-empty">
			{tab === 'install' ? t(m.pluginRackInstallEmpty) : t(m.pluginRackUninstallEmpty)}
		</div>
	{:else}
		<ul class="rack-rows" data-testid="rack-rows">
			<!-- keyed by the engine row number, not id: the catalog can list two
			     distinct plugins under one id (e.g. dsh-deepresearch by two authors) -->
			{#each visiblePlugins as plugin (plugin.n)}
				<PluginManagerRackRow {plugin} {busyId} {floorBounce} {stars} onapply={(action, id) => void apply(action, id)} />
			{/each}
		</ul>
		{#if errors.length > 0}
			<ul class="rack-errors" data-testid="rack-errors">
				{#each errors as e (e.id)}
					<li class="rack-error">{e.id}: {e.error}</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.rack {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.85rem;
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
	.rack-rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
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
