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

	async function load(): Promise<void> {
		loading = true;
		loadFailed = false;
		try {
			const res = await fetch('/api/plugins/snapshot');
			const body = await res.json();
			if (body.ok) snapshot = body.snapshot;
			else loadFailed = true;
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
				// D5: the chain kills this very server — say so, answer done.
				floorBounce = true;
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
	<PluginManagerHeader {tab} {loading} {floorBounce} ontabchange={setTab} onreload={() => void load()} />

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
			{#each visiblePlugins as plugin (plugin.id)}
				<PluginManagerRackRow {plugin} {busyId} {floorBounce} onapply={(action, id) => void apply(action, id)} />
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
