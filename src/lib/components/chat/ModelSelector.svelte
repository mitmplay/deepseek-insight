<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { DsiModelDirectory } from '$lib/types';
	import { onMount } from 'svelte';
	/**
	 * ModelSelector — the header dropdown for the session's model (POC-3 W3, 3.2).
	 *
	 * GET /api/dsh/session/{id}/models on open (the directory's only source of
	 * truth); picking a model POSTs /select-model ONCE (in-flight lock) and
	 * adopts the host's normalized selection. The current selection renders
	 * even when the catalog is empty/garbage (normalize is the connection's
	 * job — garbage-safe, never throws). BC-1/BC-2: browser API only, no
	 * server imports; the selection takes effect on the NEXT assembled step.
	 */

	let {
		/** Session id (path param for both calls). */
		sessionId,
		/** Disabled while a rename/select is in flight (header stays one-shot). */
		disabled = false,
		/** Open the menu UPWARD (bottom of page placements — the footer's
		 * PromptInput; a downward menu would clip off-screen). */
		menuUp = false
	}: {
		sessionId: string;
		disabled?: boolean;
		menuUp?: boolean;
	} = $props();

	let open = $state(false);
	let directory = $state<DsiModelDirectory | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	/** (provider, model) currently being POSTed — double-submit guard. */
	let selecting = $state<string | null>(null);

	async function load(): Promise<void> {
		if (loading) return;
		loading = true;
		error = null;
		try {
			const res = await fetch(`/api/dsh/session/${encodeURIComponent(sessionId)}/models`);
			const body = (await res.json().catch(() => null)) as (DsiModelDirectory & { ok?: boolean }) | { ok: false; error?: { message?: string } } | null;
			if (!res.ok || !body || body.ok === false) {
				const message = (body as { error?: { message?: string } } | null)?.error?.message ?? `models failed (${res.status})`;
				error = message;
				return;
			}
			directory = body as DsiModelDirectory;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	function toggle(): void {
		open = !open;
		if (open && directory === null && error === null) void load();
	}

	// 2026-08-22 (dead-turn bug follow-up): fetch once on mount — the closed
	// label must show the session's real model, not "model —". A turn that
	// dies on MISSING_CREDENTIAL is invisible when the header hides the route.
	onMount(() => {
		void load();
	});

	/** Pick one model: one POST, adopt the host's normalized selection. */
	async function pick(provider: string, model: string, effort?: string): Promise<void> {
		if (selecting !== null || disabled) return;
		const key = `${provider}::${model}::${effort ?? ''}`;
		if (key === currentKey()) return; // already selected — no wire call
		selecting = key;
		error = null;
		try {
			const res = await fetch(`/api/dsh/session/${encodeURIComponent(sessionId)}/select-model`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(
					effort === undefined ? { provider, model } : { provider, model, reasoningEffort: effort }
				)
			});
			const body = (await res.json().catch(() => null)) as {
				ok?: boolean;
				selected?: { provider: string; model: string; reasoningEffort?: string };
				error?: { message?: string };
			} | null;
			if (!res.ok || !body?.ok || !body.selected) {
				error = body?.error?.message ?? `select failed (${res.status})`;
				return;
			}
			directory = { ...(directory ?? emptyDirectory()), current: body.selected };
			open = false;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			selecting = null;
		}
	}

	function emptyDirectory(): DsiModelDirectory {
		return { current: null, routable: false, groups: [], failures: [] };
	}

	function currentKey(): string {
		const c = directory?.current;
		return c ? `${c.provider}::${c.model}::${c.reasoningEffort ?? ''}` : '';
	}

	function isCurrent(provider: string, model: string, effort?: string): boolean {
		return `${provider}::${model}::${effort ?? ''}` === currentKey();
	}

	/** Label for the closed state: current model, or "model —". */
	const currentLabel = $derived.by(() => {
		const c = directory?.current;
		if (!c) return 'model —';
		return `${c.provider} / ${c.model}`;
	});
</script>

<div class="relative">
	<button
		type="button"
		class="inline-flex items-center gap-1 rounded-md border border-[#7c3aed] px-2 py-1 text-xs font-medium text-[#7c3aed] hover:bg-slate-100 disabled:opacity-50"
		disabled={disabled}
		aria-haspopup="listbox"
		aria-expanded={open}
		data-testid="model-selector-button"
		onclick={() => toggle()}
	>
		{currentLabel}
		<span class="text-[#7c3aed]" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
	</button>
	{#if open}
		<div
			class="absolute z-10 max-h-72 w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg {menuUp ? 'bottom-full mb-1' : 'right-0 top-full mt-1'}"
			data-testid="model-selector-menu"
			role="listbox"
			aria-label={t(m.modelSelector)}
		>
			{#if loading}
				<p class="px-2 py-1.5 text-xs text-slate-400" data-testid="model-selector-loading">{t(m.loading)}</p>
			{:else if error}
				<p class="px-2 py-1.5 text-xs text-red-600" data-testid="model-selector-error" role="alert">{error}</p>
				<button
					type="button"
					class="w-full rounded px-2 py-1.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-100"
					data-testid="model-selector-retry"
					onclick={() => void load()}
				>
					{t(m.retry)}
				</button>
			{:else if directory === null || (directory.groups.length === 0 && directory.current === null)}
				<p class="px-2 py-1.5 text-xs text-slate-400" data-testid="model-selector-empty">{t(m.noModels)}</p>
			{:else}
				{#if directory.current && directory.groups.length === 0}
					{@const cur = directory.current}
					<p class="px-2 py-1.5 text-xs text-slate-500" data-testid="model-selector-current-only">
						{t(() => m.currentModel({ provider: cur.provider, model: cur.model }))}
					</p>
				{/if}
				{#each directory.groups as group (group.id)}
					<p class="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{group.name ?? group.id}</p>
					{#each group.models as m (m.id)}
						<button
							type="button"
							class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 disabled:opacity-50"
							role="option"
							aria-selected={isCurrent(group.id, m.id)}
							data-testid="model-option"
							data-provider={group.id}
							data-model={m.id}
							disabled={selecting !== null}
							onclick={() => void pick(group.id, m.id)}
						>
							<span>{m.name ?? m.id}</span>
							{#if isCurrent(group.id, m.id)}
								<span class="text-emerald-600" data-testid="model-option-current" aria-label="Selected">✓</span>
							{/if}
						</button>
					{/each}
				{/each}
				{#if directory.failures.length > 0}
					<p class="px-2 pb-1 pt-1.5 text-[10px] text-slate-400" data-testid="model-selector-failures">
						{directory.failures.length} provider{directory.failures.length === 1 ? '' : 's'} {t(m.failedToLoad)}
					</p>
				{/if}
			{/if}
		</div>
	{/if}
</div>
