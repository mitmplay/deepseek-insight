<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * WorkspaceFileTabs — the Explorer Layout's tab strip + file container
	 * (ADR 2026-09-17 D3/D5, extracted from day one per the ADR's §7
	 * give-up: the panel must not grow into the new monolith).
	 *
	 * PRESENTATION ONLY (Module Communication Map): the open-tab list, the
	 * active path, and every fetch arrive as PROPS from the owning
	 * WorkspaceExplorerPanel; the only things leaving are INTENT callbacks
	 * — onActivate (focus an open tab), onClose (the per-tab [x]). The
	 * content region is the parent's children snippet, so the panel hosts
	 * WorkspaceFile itself and this component never fetches.
	 *
	 * A closed panel drops the tabs with it (D5) — nothing here persists.
	 */
	import type { Snippet } from 'svelte';

	/** One open file tab — the panel's component state, deduped by path. */
	export interface WorkspaceFileTab {
		/** Root-relative path — identity within the panel's tab list. */
		path: string;
	}

	let {
		tabs,
		activePath,
		onActivate,
		onClose,
		children
	}: {
		/** Open tabs, in open order — the panel owns the list. */
		tabs: readonly WorkspaceFileTab[];
		/** The focused tab's path; null when no tab is open. */
		activePath: string | null;
		/** Focus intent — the panel flips its activePath. */
		onActivate: (path: string) => void;
		/** Per-tab close intent — the panel frees exactly that file (D5). */
		onClose: (path: string) => void;
		/** The file body region — the parent renders WorkspaceFile here. */
		children: Snippet;
	} = $props();

	/** Tab label — the leaf name; the full root-relative path rides the
	 *  title attribute (ADR D5). */
	function leaf(path: string): string {
		const idx = path.lastIndexOf('/');
		return idx === -1 ? path : path.slice(idx + 1);
	}
</script>

<div class="file-tabs" data-testid="workspace-file-tabs">
	{#if tabs.length > 0}
		<div class="strip" role="tablist" data-testid="workspace-file-tabstrip">
			{#each tabs as tab (tab.path)}
				<button
					type="button"
					role="tab"
					class="tab"
					class:active={tab.path === activePath}
					data-testid="workspace-file-tab-{tab.path}"
					title={tab.path}
					aria-selected={tab.path === activePath}
					onclick={() => onActivate(tab.path)}
				>
					<span class="label">{leaf(tab.path)}</span>
					<!-- stopPropagation: the [x] must never double as an activate -->
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<span
						role="button"
						tabindex="-1"
						class="close"
						data-testid="workspace-file-tabclose-{tab.path}"
						aria-label={t(m.close)}
						title={t(m.close)}
						onclick={(e) => {
							e.stopPropagation();
							onClose(tab.path);
						}}
					>×</span>
				</button>
			{/each}
		</div>
		<div class="body">{@render children()}</div>
	{:else}
		<!-- An honest empty region — never a blank area (the FilesBody rule). -->
		<div class="empty" data-testid="workspace-file-tabs-empty"></div>
	{/if}
</div>

<style>
	.file-tabs {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.strip {
		display: flex;
		flex: 0 0 auto;
		gap: 2px;
		overflow-x: auto; /* the strip scrolls when crowded (ADR D5) */
		padding: 2px 4px 0;
		border-bottom: 1px solid var(--color-border, #ddd);
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 180px;
		padding: 3px 6px;
		border: 1px solid transparent;
		border-bottom: none;
		border-radius: 6px 6px 0 0;
		background: transparent;
		font-size: 0.75rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.tab.active {
		border-color: var(--color-border, #ddd);
		background: var(--color-surface, #fff);
		font-weight: 600;
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		border-radius: 3px;
		font-size: 0.7rem;
		line-height: 1;
		color: var(--color-text-muted, #888);
	}
	.close:hover {
		background: var(--color-border, #ddd);
		color: var(--color-text, #222);
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	.empty {
		flex: 1;
	}
	/* The hosted file component (WorkspaceFilePanel) must fill the body's
	   remaining height — its own .file-panel height contract only works
	   when the direct parent chain gives it a definite box (operator bug
	   2026-09-17: the editor collapsed to content height). */
	.body :global(> *) {
		flex: 1;
		min-height: 0;
		height: auto;
	}
</style>
