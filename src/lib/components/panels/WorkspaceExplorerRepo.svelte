<script lang="ts">
	/**
	 * WorkspaceExplorerRepo — one repo's group in the Git Eye Changes tab,
	 * extracted from WorkspaceExplorerChanges (2026-09-13): the repo
	 * heading plus its changed-file rows, over the SAME contract as before
	 * (loading / unavailable / failed / empty / truncated rows — never a
	 * blank region).
	 *
	 * PRESENTATION ONLY (Module Communication Map): the panel owner keeps
	 * the git-status cache and the fetches — this component reads its
	 * status as a prop and emits the open-file intent back.
	 */
	import { workspacePanelCopy as copy } from './workspace-panel-copy';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	/** One repo's git-status view state (owner-held, cache-guarded). */
	export type ChangeStatus =
		| { kind: 'loading' }
		| { kind: 'failed'; reason: string }
		| { kind: 'unavailable' }
		| { kind: 'ready'; truncated: boolean; files: Array<{ code: string; path: string }> };

	let {
		repoRel,
		root,
		st,
		collapsed = false,
		onToggleRepo,
		onOpenFile
	}: {
		/** The repo's rel path ('' = the workspace root itself). */
		repoRel: string;
		/** Verbatim workspace root — the root repo's group heading. */
		root: string;
		/** The owner's git-status state for THIS repo (undefined = not fetched yet). */
		st: ChangeStatus | undefined;
		/** OWNER-persisted collapse state — default EXPANDED (empty collapsed list). */
		collapsed?: boolean;
		/** Collapse-toggle intent — the owner mutates the persisted collapsed list. */
		onToggleRepo: (repoRel: string) => void;
		/** File click intent — the owner dedupes and slots the file panel. */
		onOpenFile: (path: string) => void;
	} = $props();
</script>

<div class="repo-group" data-testid="git-changes-group">
	<!-- The head is the SUMMARY: clicking it toggles collapse (user,
	     2026-09-13). The collapsed set is OWNER-persisted — a hard
	     reload restores it, the same contract as the tree's expanded
	     paths and the active tab. Default is EXPANDED (an empty
	     collapsed list) so existing entries behave unchanged. -->
	<button
		class="repo-head"
		data-testid="git-changes-toggle"
		aria-expanded={!collapsed}
		onclick={() => onToggleRepo(repoRel)}
	>
		<span class="caret" aria-hidden="true">{#if !collapsed}<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z" fill="currentColor" /></svg>{:else}<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5.5 2.15137L5.92383 2.57617L8.65137 5.30273C8.90706 5.55843 9.13382 5.78438 9.29785 5.98828C9.46883 6.20088 9.61756 6.44405 9.66602 6.75C9.69222 6.91565 9.69222 7.08435 9.66602 7.25C9.61756 7.55595 9.46883 7.79912 9.29785 8.01172C9.13382 8.21561 8.90706 8.44157 8.65137 8.69727L5.92383 11.4238L5.5 11.8486L4.65137 11L5.07617 10.5762L7.80273 7.84863C8.07732 7.57405 8.24849 7.40124 8.3623 7.25977C8.46904 7.12709 8.47813 7.07728 8.48047 7.0625C8.48703 7.02105 8.48703 6.97895 8.48047 6.9375C8.47813 6.92272 8.46904 6.87291 8.3623 6.74023C8.24848 6.59876 8.07732 6.42595 7.80273 6.15137L5.07617 3.42383L4.65137 3L5.5 2.15137Z" fill="currentColor" /></svg>{/if}</span>{repoRel === '' ? root : repoRel}
	</button>
	{#if !collapsed}
	<ul class="tree">
		{#if st === undefined || st.kind === 'loading'}
			<li class="note">{copy.explorer.loading}</li>
		{:else if st.kind === 'unavailable'}
			<li class="note fail" data-testid="git-changes-unavailable">{t(m.gitEyeStatusUnavailable)}</li>
		{:else if st.kind === 'failed'}
			<li class="note fail" data-testid="git-changes-failed">{t(m.gitEyeChangesFailed)}{st.reason !== '' ? ' — ' + st.reason : ''}</li>
		{:else if st.files.length === 0}
			<li class="note">{t(m.gitEyeChangesEmpty)}</li>
		{:else}
			{#each st.files as f (f.code + f.path)}
				<li>
					<button
						class="row file"
						data-testid="git-change-row"
						onclick={() => onOpenFile(repoRel === '' ? f.path : repoRel + '/' + f.path)}
						title={f.path}
					>
						<span class="caret" aria-hidden="true"></span><span class="change-code">{f.code.trim() || '??'}</span><span class="entry-name">{f.path}</span>
					</button>
				</li>
			{/each}
			{#if st.truncated}
				<li class="note">{t(m.gitEyeChangesTruncated)}</li>
			{/if}
		{/if}
	</ul>
	{/if}
</div>

<style>
	.repo-head {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem; /* the collapse caret breathes with the heading */
		border: none;
		background: transparent;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		max-width: 100%;
	}
	.repo-head .caret {
		flex-shrink: 0;
		width: 0.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: #ff4500; /* orangered, matches the heading */
	}
	/* app.css @layer base paints bare svg accent-purple — the chevron must
	   inherit the span's orangered instead (the WorkspaceExplorerTree fix). */
	.repo-head .caret :global(svg) {
		color: inherit;
	}
	.tree {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: none;
		background: transparent;
		padding: 0.1rem 0.25rem;
		font: inherit;
		cursor: pointer;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
	}
	.caret {
		flex-shrink: 0;
		width: 0.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.repo-group {
		margin-bottom: 0.5rem;
	}
	.repo-head {
		font-weight: 600;
		color: #ff4500; /* orangered, matches the tree's repo rows */
		padding: 0.1rem 0.25rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.change-code {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: #d2691e; /* chocolate */
		width: 1.5rem;
		justify-content: center;
	}
	/* Changed-file rows (ADR D5): chocolate + bold. */
	.row .entry-name {
		color: #d2691e; /* chocolate */
		font-weight: 600;
	}
	.entry-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.note {
		color: var(--color-text-muted, #6b7280);
		font-size: 0.75rem;
		padding: 0.1rem 0.25rem;
	}
	/* Notes ("No uncommitted changes" etc.) align with the TITLE text, not
	   the chevron: head padding (0.25rem) + caret (0.75rem) + gap (0.25rem)
	   = 1.25rem; minus the note's own 0.25rem padding ⇒ 1rem margin. */
	.tree .note {
		margin-left: 1rem;
	}
	.note.fail {
		color: #b91c1c;
	}
</style>
