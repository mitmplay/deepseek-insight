<script lang="ts">
	/**
	 * PluginManagerRackRow - one rack row (The Plugin Rack ADR, 2026-09-27,
	 * D1), presentational like the shelf's SelfSection rows: every verb and
	 * all state are owned by PluginManagerPanel. The two doors follow the
	 * Shelf Credentials grammar (ADR 2026-09-22): the repo door opens the
	 * plugin's hosting repo, the author door opens the creator's profile -
	 * each rendered only when its URL exists on the reff line.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { Check, CircleUserRound, ExternalLink, LoaderCircle, Star } from '@lucide/svelte';
	import { formatCompact } from '$lib/utils/compact-number';

	interface Props {
		plugin: {
			n: string;
			id: string;
			repo: string;
			author: string | null;
			authorUrl?: string | null;
			group?: 'owned' | 'external';
			description?: string | null;
			version?: string | null;
			installed: boolean;
		};
		/** Shelf selection grammar (3.3): set membership by row n; click toggles. */
		selected?: boolean;
		onselect?: (n: string) => void;
		/** GitHub stargazers per plugin id (best-effort; absent when unfetched). */
		stars: Record<string, number>;
		busyId: string | null;
		floorBounce: boolean;
		onapply: (action: 'install' | 'remove', id: string) => void;
	}
	let { plugin, busyId, floorBounce, stars, selected, onselect, onapply }: Props = $props();
	const disabled = $derived(busyId !== null || floorBounce);
</script>

<li
		class="rack-row"
		class:rack-row-selected={selected}
		data-testid={'rack-row-' + plugin.id}
		data-selected={selected ? 'true' : undefined}>
	{#if onselect && !plugin.installed}
		<button
			type="button"
			class="rack-select"
			data-testid={'rack-select-' + plugin.n}
			aria-pressed={selected ? 'true' : 'false'}
			onclick={() => onselect(plugin.n)}
		>
			{selected ? '☑' : '☐'}
		</button>
	{/if}
	<span class="rack-n">{plugin.n}.</span>
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
	{#if plugin.author}
		<span class="rack-author">{t(m.pluginRackBy)} {plugin.author}</span>
	{/if}
	<span class="rack-verb">
		{#if plugin.installed}
			<button
				type="button"
				data-testid={'rack-uninstall-' + plugin.id}
				disabled={disabled}
				onclick={() => onapply('remove', plugin.id)}
			>
				{#if busyId === plugin.id}
					<span class="rack-busy" data-testid={'rack-busy-' + plugin.id}>
						<span class="spin"><LoaderCircle size={11} aria-hidden="true" /></span>
						{t(m.pluginRackUninstall)}
					</span>
				{:else}
					{t(m.pluginRackUninstall)}
				{/if}
			</button>
		{:else if !onselect}
			<button
				type="button"
				data-testid={'rack-install-' + plugin.id}
				disabled={disabled}
				onclick={() => onapply('install', plugin.id)}
			>
				{#if busyId === plugin.id}
					<span class="rack-busy" data-testid={'rack-busy-' + plugin.id}>
						<span class="spin"><LoaderCircle size={11} aria-hidden="true" /></span>
						{t(m.pluginRackInstall)}
					</span>
				{:else}
					{t(m.pluginRackInstall)}
				{/if}
			</button>
		{/if}
	</span>
	{#if typeof stars[plugin.id] === 'number'}
		<!-- The star count rides AFTER the row's verb (the install button) -->
		<span class="rack-stars" data-testid={'rack-stars-' + plugin.id} title={t(m.pluginRackStars)}>
			<Star size={11} aria-hidden="true" />
			{formatCompact(stars[plugin.id])}
		</span>
	{/if}
	<span class="rack-doors">
		<!-- Two doors (Shelf Credentials grammar): repo + author profile,
		     placed after the row's verb -->
		<a
			class="rack-door"
			data-testid={'rack-door-repo-' + plugin.id}
			href={plugin.repo}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={t(m.pluginRackOpenRepo)}
			title={t(m.pluginRackOpenRepo)}
		>
			<ExternalLink size={12} aria-hidden="true" />
		</a>
		{#if plugin.authorUrl}
			<a
				class="rack-door"
				data-testid={'rack-door-author-' + plugin.id}
				href={plugin.authorUrl}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={t(m.pluginRackOpenAuthor)}
				title={t(m.pluginRackOpenAuthor)}
			>
				<CircleUserRound size={12} aria-hidden="true" />
			</a>
		{/if}
	</span>
</li>

<style>
	.rack-row {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr) auto auto auto;
		align-items: center;
		gap: 0.35rem;
		padding: 0.12rem 0.4rem;
		border-radius: 6px;
	}
	.rack-row:hover {
		background: color-mix(in srgb, currentcolor 6%, transparent);
	}
	.rack-n {
		opacity: 0.55;
		font-variant-numeric: tabular-nums;
		padding-right: 0.15rem;
	}
	.rack-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		margin-left: 0.4rem;
		padding: 0 0.35rem;
		border-radius: 999px;
		font-size: 0.7rem;
		background: color-mix(in srgb, green 18%, transparent);
	}
	.rack-author {
		opacity: 0.6;
		font-size: 0.75rem;
	}
	.rack-stars {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.75rem;
		opacity: 0.65;
		font-variant-numeric: tabular-nums;
	}
	.rack-doors {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.rack-door {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem;
		border-radius: 0.25rem;
		color: inherit;
		opacity: 0.7;
	}
	.rack-door:hover {
		opacity: 1;
	}
	.rack-busy {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.spin {
		display: inline-flex;
		animation: rack-verb-spin 1s linear infinite;
	}
	@keyframes rack-verb-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.rack-verb button {
		cursor: pointer;
	}
	.rack-verb button:disabled {
		cursor: default;
		opacity: 0.6;
	}
</style>
