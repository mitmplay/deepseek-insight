<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	/**
	 * SettingsSkillsSelfSkill - ONE skill card of a shelf source group
	 * (The Shelf Chrome ADR grammar): a header row (checkbox + name/id
	 * pair, tier pill, installed/foreign badge, uninstall verb) over an
	 * overview paragraph lifted from the skill's SKILL.md. Presentational:
	 * the panel owns selection and the uninstall call; this renders one
	 * card and reports intents.
	 */
	interface Props {
		/** The skill card's id — identity and the uninstall key. */
		id: string;
		/** The skill's row key (n) — the selection set's member. */
		n: string;
		/** Optional tier pill payload; null renders no pill. */
		tier: string | null;
		/** Whether the skill is currently checked. */
		checked: boolean;
		/** Whether to render the uninstall verb (uninstall tab). */
		uninstallable: boolean;
		/** Disables the uninstall verb while a call is in flight. */
		busy: boolean;
		/** The installed/foreign badge text; null renders no badge. */
		badge: string | null;
		/** SKILL.md overview text; null renders the muted fallback line. */
		overview: string | null;
		/** Row-check intent — the panel bridges it to its selection set. */
		ontoggle?: (n: string) => void;
		/** Uninstall intent for this skill id. */
		onuninstall?: () => void;
	}
	let { id, n, tier, checked, uninstallable, busy, badge, overview, ontoggle, onuninstall }: Props = $props();
</script>

<li class="shelf-card" data-testid={'shelf-row-' + id} class:checked>
	<div class="shelf-card-head">
		<label class="shelf-row-main">
			<input type="checkbox" aria-label={id} {checked} onchange={() => ontoggle?.(n)} />
			<span class="shelf-n">{n}</span>
			<span class="shelf-id">{id}</span>
		</label>
		{#if tier}<span class="shelf-tier" data-testid="shelf-tier">{tier}</span>{/if}
		{#if badge}
			<span class="shelf-badge" data-testid="shelf-badge">{badge}</span>
		{/if}
		{#if uninstallable}
			<button type="button" class="shelf-uninstall" data-testid={'shelf-uninstall-' + id} onclick={() => onuninstall?.()} disabled={busy}>{t(m.skillsShelfUninstall)}</button>
		{/if}
	</div>
	{#if overview}
		<p class="shelf-overview" data-testid="shelf-overview">{overview}</p>
	{:else}
		<p class="shelf-overview shelf-overview-empty" data-testid="shelf-overview-empty">{t(m.skillsShelfNoOverview)}</p>
	{/if}
</li>

<style>
	.shelf-card {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.375rem;
		background: var(--color-surface, #fff);
	}
	.shelf-card:hover {
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 40%, var(--color-border, #d0d7de));
	}
	.shelf-card.checked {
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 55%, var(--color-border, #d0d7de));
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 6%, var(--color-surface, #fff));
	}
	.shelf-card-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.shelf-row-main {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		cursor: pointer;
	}
	.shelf-n {
		opacity: 0.55;
		font-variant-numeric: tabular-nums;
	}
	.shelf-id {
		overflow: hidden;
		color: var(--color-fuchsia-700, #57606a);
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	.shelf-tier {
		font-size: 0.7rem;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		border: 1px solid #e67e22;
		color: #e67e22;
	}
	.shelf-badge {
		font-size: 0.7rem;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		background: color-mix(in srgb, #27ae60 18%, transparent);
		color: #27ae60;
	}
	.shelf-uninstall {
		font-size: 0.7rem;
	}
	.shelf-overview {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.45;
		color: var(--color-purple-700, #57606a);
	}
	.shelf-overview-empty {
		font-style: italic;
		opacity: 0.7;
	}
</style>
