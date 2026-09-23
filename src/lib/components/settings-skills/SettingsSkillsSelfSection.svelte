<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { ChevronDown, ChevronRight, CircleUserRound, ExternalLink, Check, LoaderCircle } from '@lucide/svelte';
	import SettingsSkillsSelfSkill from './SettingsSkillsSelfSkill.svelte';

	/**
	 * SettingsSkillsSelfSection - ONE source group of the Skill Shelf
	 * (The Shelf Chrome ADR grammar): a collapsible group head (caret,
	 * source id, author, row count) over the tab-scoped, search-filtered
	 * skill rows (checkbox + names, tier/badge, uninstall verb).
	 * Presentational: the panel owns selection, collapse state, and the
	 * uninstall call; this renders one section and reports intents.
	 */
	interface ShelfSkill {
		n: string;
		id: string;
		tier: string | null;
		installed: boolean;
		signed: boolean;
		overview: string | null;
	}
	interface Props {
		/** The source group's id — identity and collapse key. */
		sourceId: string;
		/** 1-based position in the snapshot's source order — the group
		 *  prefix (1., 2., …) that matches the skills' n addressing (2.1). */
		index: number;
		/** The source's author display name. */
		author: string;
		/** Author profile URL (SKR link) — null renders no author door (D5). */
		authorUrl: string | null;
		/** Collection version from the repo's package.json — null renders no tag (D5). */
		version: string | null;
		/** Browsable repo URL — null renders no repo door (D5). */
		repoUrl: string | null;
		/** The visible rows (already tab-scoped + search-filtered). */
		skills: ShelfSkill[];
		/** Whether the group is currently collapsed. */
		hidden: boolean;
		/** Selected row keys (skill n) — the panel's one set. */
		selected: ReadonlySet<string>;
		/** Ids the uninstall verb is allowed on (signed set). */
		uninstallable: ReadonlySet<string>;
		/** Uninstall verb renders only on this tab (D4). */
		tab: 'install' | 'uninstall';
		/** Disables the uninstall verb while a call is in flight. */
		busy: boolean;
		/** Row-check intent — the panel bridges it to its selection set. */
		ontoggle?: (n: string) => void;
		/** Group-head intent — toggle this source's collapse. */
		ontogglegroup?: () => void;
		/** Uninstall intent for one skill id. */
		onuninstall?: (id: string) => void;
		/** Live harvest state for THIS source (Reload Rememberer,
		 *  2026-09-23): 'working' shows a mini spinner on the group head,
		 *  'done' a check; null/pending renders nothing. */
		reloadChip?: 'pending' | 'working' | 'done' | null;
	}
	let {
		sourceId,
		index,
		author,
		authorUrl,
		version,
		repoUrl,
		skills,
		hidden,
		selected,
		uninstallable,
		tab,
		busy,
		ontoggle,
		ontogglegroup,
		onuninstall,
		reloadChip = null
	}: Props = $props();

	/** The installed/foreign badge — null renders no badge. */
	function badgeFor(skill: ShelfSkill): string | null {
		if (skill.signed) return t(m.skillsShelfBadgeInstalled);
		if (skill.installed) return t(m.skillsShelfBadgeForeign);
		return null;
	}
</script>

<section class="shelf-source" data-testid={'shelf-source-' + sourceId}>
	<div class="shelf-head">
		<button
			type="button"
			class="shelf-group-head"
			data-testid={'shelf-group-' + sourceId}
			aria-expanded={!hidden}
			onclick={() => ontogglegroup?.()}
		>
			<span class="shelf-caret">{#if hidden}<ChevronRight size={12} aria-hidden="true" />{:else}<ChevronDown size={12} aria-hidden="true" />{/if}</span>
			<span class="shelf-index">{index}.</span>
			{sourceId}
			{#if version}<span class="shelf-version" data-testid={'shelf-version-' + sourceId}>(v{version})</span>{/if}
			<span class="shelf-author">{author}</span>
			<span class="shelf-count">{skills.length}</span>
			{#if reloadChip === 'working'}<span class="shelf-reload-chip" data-testid={'shelf-source-working-' + sourceId}><LoaderCircle size={11} aria-hidden="true" /></span>{:else if reloadChip === 'done'}<span class="shelf-reload-chip" data-testid={'shelf-source-done-' + sourceId}><Check size={11} aria-hidden="true" /></span>{/if}
		</button>
		{#if repoUrl}
			<a
				class="shelf-door"
				data-testid={'shelf-door-repo-' + sourceId}
				href={repoUrl}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={t(m.skillsShelfOpenRepo)}
				title={t(m.skillsShelfOpenRepo)}
			>
				<ExternalLink size={12} aria-hidden="true" />
			</a>
		{/if}
		{#if authorUrl}
			<a
				class="shelf-door"
				data-testid={'shelf-door-author-' + sourceId}
				href={authorUrl}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={t(m.skillsShelfOpenAuthor)}
				title={t(m.skillsShelfOpenAuthor)}
			>
				<!-- Lucide dropped brand marks; CircleUserRound carries the author door -->
				<CircleUserRound size={12} aria-hidden="true" />
			</a>
		{/if}
	</div>
	{#if !hidden}
		<ul class="shelf-rows">
			{#each skills as skill (skill.n)}
				<SettingsSkillsSelfSkill
					id={skill.id}
					n={skill.n}
					tier={skill.tier}
					checked={selected.has(skill.n)}
					uninstallable={tab === 'uninstall' && uninstallable.has(skill.id)}
					{busy}
					badge={badgeFor(skill)}
					overview={skill.overview}
					ontoggle={(n) => ontoggle?.(n)}
					onuninstall={() => onuninstall?.(skill.id)}
				/>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.shelf-head {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		width: 100%;
	}
	.shelf-group-head {
		display: flex;
		flex: 1;
		min-width: 0;
		align-items: center;
		gap: 0.375rem;
		width: 100%;
		border: none;
		background: transparent;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		cursor: pointer;
		padding: 0.25rem 0;
		text-align: left;
	}
	.shelf-caret {
		font-size: 0.7rem;
	}
	.shelf-index {
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		opacity: 0.6;
	}
	.shelf-author {
		font-weight: 400;
		opacity: 0.6;
		text-transform: none;
		letter-spacing: normal;
	}
	/* The credentials (Shelf Credentials ADR D1/D5): version tag rides
	   inside the button (text, not a control); doors are anchors OUTSIDE
	   the button — clicking one never folds the group. */
	.shelf-version {
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		opacity: 0.6;
		text-transform: none;
		letter-spacing: normal;
	}
	.shelf-door {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem;
		color: #52606d;
		opacity: 0.65;
		transition: color 0.15s ease, opacity 0.15s ease;
	}
	.shelf-door:hover {
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		opacity: 1;
	}
	.shelf-door :global(svg) {
		display: block;
	}
	.shelf-count {
		margin-left: auto;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		opacity: 0.6;
	}
	/* Live harvest chip (Reload Rememberer, 2026-09-23): mini spinner while
	   THIS source builds, a quiet check once it lands. */
	.shelf-reload-chip {
		display: inline-flex;
		align-items: center;
		opacity: 0.8;
	}
	.shelf-reload-chip :global(svg) {
		animation: shelf-chip-spin 1s linear infinite;
	}
	.shelf-reload-chip[data-testid^='shelf-source-done'] :global(svg) {
		animation: none;
		color: #1a7f37;
	}
	@keyframes shelf-chip-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.shelf-rows {
		list-style: none;
		margin: 0;
		padding: 0 0 0.25rem;
	}
</style>
