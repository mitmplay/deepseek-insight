<script lang="ts">
	import { CircleUser, ExternalLink, Star } from '@lucide/svelte';
	import { formatCompact } from '$lib/utils/compact-number';
	/**
	 * PluginManagerStars — the source head's meta cluster (extracted from
	 * PluginManagerPanel): the first plugin's GitHub star badge plus the
	 * repo and creator doors; doors live INSIDE the head button here, so
	 * their targets are best-effort off the first row of the source.
	 */
	let {
		/** The source group's id — every testid key. */
		id,
		/** The source's repo URL — the repo door's href. */
		repo,
		/** The source's author — null hides the creator door. */
		author,
		/** The source's rows — first row carries stars + authorUrl. */
		plugins,
		/** GitHub stargazers per plugin id — absent ids leave the badge off. */
		stars
	}: {
		id: string;
		repo: string;
		author: string | null;
		plugins: { id: string; authorUrl?: string | null }[];
		stars: Record<string, number>;
	} = $props();

	const slug = (value: string): string => value.replace(/[^a-zA-Z0-9-]/g, '-');
</script>

<span class="rack-source-meta">
	{#if plugins[0] && stars[plugins[0].id]}
		<span class="rack-stars" data-testid={'rack-stars-' + slug(id)}><Star size={12} aria-hidden="true" />
		    {formatCompact(stars[plugins[0].id])}
		</span>
	{/if}
	<span class="rack-source-doors">
		<a class="rack-door" target="_blank" rel="noopener noreferrer" data-testid={'rack-door-repo-' + slug(id)} href={repo} aria-label="Open the plugin repo" title="Open the plugin repo"><ExternalLink size={12} aria-hidden="true" /></a>
		{#if author && plugins[0] && plugins[0].authorUrl}
			<a class="rack-door" target="_blank" rel="noopener noreferrer" data-testid={'rack-door-author-' + slug(id)} href={plugins[0].authorUrl} aria-label="Open the creator profile" title="Open the creator profile"><CircleUser size={12} aria-hidden="true" /></a>
		{/if}
	</span>
</span>

<style>
	.rack-source-meta {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}
	.rack-source-doors {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.rack-stars {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-weight: 400;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.rack-stars :global(svg) {
		display: block;
	}
	.rack-door {
		display: inline-flex;
		color: inherit;
		opacity: 0.7;
	}
	.rack-door:hover {
		opacity: 1;
	}
</style>
