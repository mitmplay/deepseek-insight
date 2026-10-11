<script lang="ts">
	/**
	 * WorkspaceExplorerChanges — the Git Eye Changes tab's per-repo list,
	 * extracted from WorkspaceExplorerPanel (2026-09-13): one group per
	 * repo, rows per changed file, over the SAME contract as before
	 * (loading / unavailable / failed / empty / truncated rows — never a
	 * blank region).
	 *
	 * The per-repo group itself lives in WorkspaceExplorerRepo (extracted
	 * 2026-09-13) — this file keeps the repo list and delegates each group.
	 *
	 * PRESENTATION ONLY (Module Communication Map): the panel owner keeps
	 * the git-status cache and the fetches — this component reads them as
	 * props and emits the open-file intent back.
	 */

	import WorkspaceExplorerRepo from './WorkspaceExplorerRepo.svelte';
	import type { ChangeStatus } from './WorkspaceExplorerRepo.svelte';

	let {
		root,
		changesRepos,
		changesStatuses,
		collapsedRepos,
		onToggleRepo,
		onOpenFile
	}: {
		/** Verbatim workspace root — the root repo's group heading. */
		root: string;
		/** Repos under the workspace root, as rel paths ('' first when the root is one). */
		changesRepos: readonly string[];
		/** The owner's rel → git-status state map. */
		changesStatuses: Record<string, ChangeStatus>;
		/** OWNER-persisted collapsed repo rel paths — survives a hard reload. */
		collapsedRepos: readonly string[];
		/** Collapse-toggle intent — the owner mutates the persisted collapsed list. */
		onToggleRepo: (repoRel: string) => void;
		/** File click intent — the owner dedupes and slots the file panel. */
		onOpenFile: (path: string) => void;
	} = $props();
</script>

{#each changesRepos as repoRel (repoRel)}
	<WorkspaceExplorerRepo
		{repoRel}
		{root}
		st={changesStatuses[repoRel]}
		collapsed={collapsedRepos.includes(repoRel)}
		{onToggleRepo}
		{onOpenFile}
	/>
{/each}
