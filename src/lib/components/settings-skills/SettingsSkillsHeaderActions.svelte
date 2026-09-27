<script lang="ts">
	/**
	 * SettingsSkillsHeaderActions - the shelf header's action cluster
	 * (The Shelf Chrome ADR): the reload verb + progress/cancel
	 * (install tab only) and the lineage-fold pill (cross-tab by
	 * contract, ADR D2). Presentational: every verb and all state are
	 * owned by SettingsSkillsPanel.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { RotateCw, ChevronsDownUp, ChevronsUpDown, LoaderCircle, Check, X } from '@lucide/svelte';

	interface Props {
		tab: 'install' | 'uninstall';
		reloadState: 'idle' | 'loading' | 'done';
		busy: boolean;
		progress: {
			done: number;
			total: number;
			skillDone: number;
			skillTotal: number;
			sources: Array<{ name: string; state: 'pending' | 'working' | 'done' }>;
		} | null;
		onreload: () => void;
		oncancelreload: () => void;
		oncollapseall: () => void;
		onexpandall: () => void;
	}
	let { tab, reloadState, busy, progress, onreload, oncancelreload, oncollapseall, onexpandall }: Props = $props();
</script>

<div class="shelf-header-actions">
	{#if tab === 'install'}
		<button
			type="button"
			class="shelf-reload"
			class:reloading={reloadState === 'loading'}
			class:reloaded={reloadState === 'done'}
			data-testid="shelf-reload"
			data-reload-state={reloadState}
			title={reloadState === 'loading' ? t(m.skillsShelfReloading) : reloadState === 'done' ? t(m.skillsShelfReloaded) : t(m.skillsShelfReload)}
			aria-label={reloadState === 'loading' ? t(m.skillsShelfReloading) : reloadState === 'done' ? t(m.skillsShelfReloaded) : t(m.skillsShelfReload)}
			onclick={onreload}
			disabled={busy}
		>
			{#if reloadState === 'loading'}<LoaderCircle size={13} aria-hidden="true" />{:else if reloadState === 'done'}<Check size={13} aria-hidden="true" />{:else}<RotateCw size={13} aria-hidden="true" />{/if}
			{#if reloadState === 'loading' && progress}
				<span class="shelf-reload-progress" data-testid="shelf-reload-progress">{progress.done}/{progress.total}{#if progress.skillTotal > 0}&nbsp;·&nbsp;{progress.skillDone}/{progress.skillTotal}{/if}</span>
			{/if}
		</button>
		{#if tab === 'install' && reloadState === 'loading'}
			<button
				type="button"
				class="shelf-reload-cancel"
				data-testid="shelf-reload-cancel"
				title={t(m.skillsShelfReloadCancel)}
				aria-label={t(m.skillsShelfReloadCancel)}
				onclick={oncancelreload}
			>
				<X size={13} aria-hidden="true" />
			</button>
		{/if}
	{/if}
	<!-- The lineage-fold pill grammar (SidebarOpenPanelTree): ONE
	     joined pill, icon-only segments, i18n tooltip + aria-label.
	     Cross-tab by contract (ADR D2) — sits AFTER the reload verb. -->
	<div class="seg-group" role="group" aria-label={t(m.skillsShelfTitle)} data-testid="shelf-fold-toggle">
		<button
			type="button"
			class="seg left"
			aria-label={t(m.skillsShelfCollapseAll)}
			title={t(m.skillsShelfCollapseAll)}
			data-testid="shelf-collapse-all"
			onclick={oncollapseall}
		>
			<ChevronsDownUp size={12} aria-hidden="true" />
		</button>
		<button
			type="button"
			class="seg right"
			aria-label={t(m.skillsShelfExpandAll)}
			title={t(m.skillsShelfExpandAll)}
			data-testid="shelf-expand-all"
			onclick={onexpandall}
		>
			<ChevronsUpDown size={12} aria-hidden="true" />
		</button>
	</div>
</div>

<style>
	.shelf-header-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}
	.shelf-reload {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem 0.35rem;
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		background: transparent;
		cursor: pointer;
	}
	.shelf-reload:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	/* Reload feedback: spinner rotates while the reload round-trips; the
	   check flashes green for the 5s done window. */
	.shelf-reload.reloading {
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 55%, #1e3a8a);
	}
	.shelf-reload.reloading :global(svg) {
		animation: shelf-reload-spin 1s linear infinite;
	}
	.shelf-reload.reloaded {
		color: #1a7f37;
		border-color: #1a7f37;
	}
	@keyframes shelf-reload-spin {
		to {
			transform: rotate(360deg);
		}
	}
	/* Progress counter + cancel verb (Reload Rememberer, 2026-09-23). */
	.shelf-reload-progress {
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
		padding-inline: 0.15rem;
	}
	.shelf-reload-cancel {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem 0.35rem;
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		background: transparent;
		cursor: pointer;
		color: inherit;
	}
	.shelf-reload-cancel:hover {
		color: #cf222e;
		border-color: #cf222e;
	}
	/* The fold pill — SidebarOpenPanelTree's seg-group contract: ONE
	   joined pill, zero gap, outer 9999px curves, icon-only segments;
	   rest #52606d, hover accent-deep navy. */
	.seg-group {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
	}
	.seg {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, #fff);
		background: transparent;
		color: #52606d;
		line-height: 1;
		padding: 0.15rem 0.275rem;
		cursor: pointer;
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.seg :global(svg) {
		display: block;
	}
	.seg.left {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		border-top-left-radius: 9999px;
		border-bottom-left-radius: 9999px;
	}
	.seg.right {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
		border-top-right-radius: 9999px;
		border-bottom-right-radius: 9999px;
		border-left-width: 0;
	}
	.seg:not(:disabled):hover {
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 12%, #fff);
	}
	.seg:focus-visible {
		outline: 2px solid #1e3a8a;
		outline-offset: -2px;
	}
</style>
