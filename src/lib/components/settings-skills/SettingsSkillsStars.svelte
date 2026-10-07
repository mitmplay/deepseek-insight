<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { Star } from '@lucide/svelte';
	import { formatCompact } from '$lib/utils/compact-number';

	/**
	 * SettingsSkillsStars — the group head's stargazer badge (extracted
	 * from SettingsSkillsSection): the repo's GitHub star count in the
	 * compact form; null renders nothing.
	 */
	let {
		/** The source group's id — the badge's testid key. */
		sourceId,
		/** GitHub stargazers for the source repo — null renders no badge. */
		stars
	}: {
		sourceId: string;
		stars: number | null;
	} = $props();
</script>

{#if stars !== null}
	<span class="shelf-stars" data-testid={'shelf-stars-' + sourceId} title={t(m.skillsShelfStars)}>
		<Star size={11} aria-hidden="true" />
		{formatCompact(stars)}
	</span>
{/if}

<style>
	.shelf-stars {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-weight: 400;
		font-size: 0.75rem;
		opacity: 0.65;
		font-variant-numeric: tabular-nums;
		text-transform: none;
		letter-spacing: normal;
	}
</style>
