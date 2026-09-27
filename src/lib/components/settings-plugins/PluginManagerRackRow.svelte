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
	import { Check, CircleUserRound, ExternalLink } from '@lucide/svelte';

	interface Props {
		plugin: {
			n: string;
			id: string;
			repo: string;
			author: string | null;
			authorUrl?: string | null;
			installed: boolean;
		};
		busyId: string | null;
		floorBounce: boolean;
		onapply: (action: 'install' | 'remove', id: string) => void;
	}
	let { plugin, busyId, floorBounce, onapply }: Props = $props();
	const disabled = $derived(busyId !== null || floorBounce);
</script>

<li class="rack-row" data-testid={'rack-row-' + plugin.id}>
	<span class="rack-n">{plugin.n}</span>
	<span class="rack-id">
		{plugin.id}
		{#if plugin.installed}
			<span class="rack-badge" data-testid={'rack-badge-' + plugin.id} role="status" aria-label={t(m.pluginRackInstalled)}>
				<Check size={11} aria-hidden="true" /> {t(m.pluginRackInstalled)}
			</span>
		{/if}
	</span>
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
				{busyId === plugin.id ? t(m.pluginRackUninstalling) : t(m.pluginRackUninstall)}
			</button>
		{:else}
			<button
				type="button"
				data-testid={'rack-install-' + plugin.id}
				disabled={disabled}
				onclick={() => onapply('install', plugin.id)}
			>
				{busyId === plugin.id ? t(m.pluginRackInstalling) : t(m.pluginRackInstall)}
			</button>
		{/if}
	</span>
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
		grid-template-columns: 1.6rem 1fr auto auto auto;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0.4rem;
		border-radius: 6px;
	}
	.rack-row:hover {
		background: color-mix(in srgb, currentcolor 6%, transparent);
	}
	.rack-n {
		opacity: 0.55;
		font-variant-numeric: tabular-nums;
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
	.rack-verb button {
		cursor: pointer;
	}
	.rack-verb button:disabled {
		cursor: default;
		opacity: 0.6;
	}
</style>
