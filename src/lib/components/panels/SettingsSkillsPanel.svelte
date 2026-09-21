<script lang="ts">
	/**
	 * SettingsSkillsPanel - The Skill Shelf (ADR 2026-09-20, D1/D5).
	 * Renders the snapshot: numbered rows per source, installed/signed
	 * badges, multi-select install with confirm, uninstall ONLY on the
	 * signed rows the API's uninstallable list carries. The content owns
	 * its fetches (/api/skills/*); the panel never touches the engine.
	 */
	import { onMount } from 'svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	interface ShelfSkill {
		n: string;
		id: string;
		path: string;
		tier: string | null;
		installed: boolean;
		signed: boolean;
		installedFrom: string | null;
	}
	interface ShelfSource {
		id: string;
		author: string;
		repo: string;
		skills: ShelfSkill[];
	}
	interface ShelfSnapshot {
		generatedAt: string;
		sources: ShelfSource[];
	}

	let { onclose }: { onclose: () => void } = $props();

	let snapshot = $state<ShelfSnapshot | null>(null);
	let uninstallable = $state<ReadonlySet<string>>(new Set());
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let selected = $state<ReadonlySet<string>>(new Set());
	let busy = $state(false);
	let note = $state<string | null>(null);
	let rescanNote = $state(false);

	async function loadSnapshot(): Promise<void> {
		loading = true;
		loadError = null;
		try {
			const res = await fetch('/api/skills/snapshot');
			const body = await res.json();
			if (!body.ok) throw new Error(body.error ?? 'snapshot failed');
			snapshot = body.snapshot;
			uninstallable = new Set(body.uninstallable as string[]);
		} catch (e) {
			loadError = String((e as Error).message);
		} finally {
			loading = false;
		}
	}

	function toggle(id: string): void {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	async function runInstall(): Promise<void> {
		if (selected.size === 0 || busy) return;
		busy = true;
		note = null;
		try {
			const res = await fetch('/api/skills/install', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ targets: [...selected] })
			});
			const body = await res.json();
			note = body.ok ? null : (body.error ?? 'install reported failures');
			if (body.ok) rescanNote = true;
			selected = new Set();
			await loadSnapshot();
		} catch (e) {
			note = String((e as Error).message);
		} finally {
			busy = false;
		}
	}

	async function runUninstall(id: string): Promise<void> {
		if (busy) return;
		busy = true;
		note = null;
		try {
			const res = await fetch('/api/skills/uninstall', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ids: [id] })
			});
			if (res.status === 409) note = t(m.skillsShelfUnsignedRefusal);
			await loadSnapshot();
		} catch (e) {
			note = String((e as Error).message);
		} finally {
			busy = false;
		}
	}

	async function runReload(): Promise<void> {
		if (busy) return;
		busy = true;
		note = null;
		try {
			const res = await fetch('/api/skills/reload', { method: 'POST' });
			const body = await res.json();
			if (!body.ok) throw new Error(body.error ?? 'reload failed');
			snapshot = body.snapshot;
			uninstallable = new Set(body.uninstallable as string[]);
		} catch (e) {
			note = String((e as Error).message);
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		void loadSnapshot();
	});

	function badgeFor(skill: ShelfSkill): string | null {
		if (skill.signed) return t(m.skillsShelfBadgeInstalled);
		if (skill.installed) return t(m.skillsShelfBadgeForeign);
		return null;
	}
</script>

<div class="skill-shelf" data-testid="skill-shelf">
	<div class="shelf-header">
		<span class="shelf-title">{t(m.skillsShelfTitle)}</span>
		<div class="shelf-actions">
			<button type="button" data-testid="shelf-reload" onclick={runReload} disabled={busy}>{t(m.skillsShelfReload)}</button>
			<button type="button" data-testid="shelf-close" onclick={onclose} aria-label={t(m.close)}>{t(m.close)}</button>
		</div>
	</div>
	{#if loading}
		<p class="shelf-note" data-testid="shelf-loading">{t(m.skillsShelfLoading)}</p>
	{:else if loadError}
		<p class="shelf-note shelf-error" data-testid="shelf-error">{loadError}</p>
	{:else if snapshot}
		<p class="shelf-note" data-testid="shelf-generated">{t(m.skillsShelfGeneratedAt)}: {snapshot.generatedAt}</p>
		{#if rescanNote}<p class="shelf-note" data-testid="shelf-rescan">{t(m.skillsShelfRescan)}</p>{/if}
		{#if note}<p class="shelf-note shelf-error" data-testid="shelf-note">{note}</p>{/if}
		{#each snapshot.sources as source (source.id)}
			<section class="shelf-source" data-testid={'shelf-source-' + source.id}>
				<h3 class="shelf-source-title">{source.id} <span class="shelf-author">{source.author}</span></h3>
				<ul class="shelf-rows">
					{#each source.skills as skill (skill.n)}
						<li class="shelf-row" data-testid={'shelf-row-' + skill.id}>
							<label class="shelf-row-main">
								{#if !skill.installed}
									<input type="checkbox" aria-label={skill.id} checked={selected.has(skill.n)} onchange={() => toggle(skill.n)} />
								{/if}
								<span class="shelf-n">{skill.n}</span>
								<span class="shelf-id">{skill.id}</span>
							</label>
							{#if skill.tier}<span class="shelf-tier" data-testid="shelf-tier">{skill.tier}</span>{/if}
							{#if badgeFor(skill)}
								<span class="shelf-badge" data-testid="shelf-badge">{badgeFor(skill)}</span>
							{/if}
							{#if uninstallable.has(skill.id)}
								<button type="button" class="shelf-uninstall" data-testid={'shelf-uninstall-' + skill.id} onclick={() => runUninstall(skill.id)} disabled={busy}>{t(m.skillsShelfUninstall)}</button>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/each}
		<div class="shelf-install-bar">
			<button type="button" data-testid="shelf-install" onclick={runInstall} disabled={busy || selected.size === 0}>
				{t(m.skillsShelfInstall)} ({selected.size})
			</button>
		</div>
	{/if}
</div>

<style>
	.skill-shelf {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		height: 100%;
		overflow: auto;
		padding: 0.75rem;
		font-size: 0.85rem;
	}
	.shelf-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.shelf-title {
		font-weight: 600;
	}
	.shelf-actions {
		display: flex;
		gap: 0.375rem;
	}
	.shelf-note {
		color: var(--text-muted, #888);
		margin: 0;
	}
	.shelf-error {
		color: #e74c3c;
	}
	.shelf-source-title {
		font-size: 0.8rem;
		font-weight: 600;
		margin: 0.5rem 0 0.25rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.8;
	}
	.shelf-author {
		font-weight: 400;
		opacity: 0.6;
		text-transform: none;
		letter-spacing: normal;
	}
	.shelf-rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.shelf-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.15rem 0.25rem;
		border-radius: 4px;
	}
	.shelf-row:hover {
		background: color-mix(in srgb, currentColor 6%, transparent);
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
		text-overflow: ellipsis;
		white-space: nowrap;
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
	.shelf-install-bar {
		position: sticky;
		bottom: 0;
		padding: 0.5rem 0;
		background: var(--panel-bg, inherit);
	}
</style>
