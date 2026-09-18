<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * WorkspaceActionsMenu — the workspace chip's Rename / Delete popup
	 * (Chip Menu ADR D2, 2026-09-05). The registered chip's click opens
	 * this menu (the header resolves the workspaceId by path at open,
	 * ADR D4 — a ghost never reaches here).
	 *
	 * Three faces, one inline surface:
	 *  - menu: Rename / Delete rows (Delete danger-styled, rose)
	 *  - renaming: inline input seeded with the current registry title;
	 *    confirm disabled on trim-empty (the route refuses it anyway —
	 *    the disable is affordance, the route is enforcement)
	 *  - deleting: inline confirm whose copy states the honest cost —
	 *    the workspace leaves the registry, its sessions STAY and turn
	 *    ghost-grey (the host removes only the registry row)
	 *
	 * Transport is fetch to DSI's own routes (BC-1); the menu owns no
	 * wire code. On success it just closes — the settle (upsert/remove
	 * frame → registry cache → spine poll) owns the screen (ADR D6: no
	 * optimistic mutation). Refusals render inline, code verbatim.
	 *
	 * Closes on Escape and outside click. Anchored by its host (the
	 * header renders it in a positioned wrapper beside the chip).
	 */
	type Face = 'menu' | 'renaming' | 'deleting';

	let {
		workspaceId,
		currentTitle,
		onclose
	}: {
		/** Registry id resolved at open (ADR D4) — never cached. */
		workspaceId: string;
		/** Current registry title — the rename input's seed. */
		currentTitle: string;
		onclose: () => void;
	} = $props();

	let face = $state<Face>('menu');
	// Seeded at mount, deliberately: the menu remounts per open, so the
	// input always starts from the CURRENT registry title.
	// svelte-ignore state_referenced_locally
	let draft = $state(currentTitle);
	let busy = $state(false);
	/** Inline refusal (route error code + message); null while clean. */
	let error = $state<{ code: string; message: string } | null>(null);
	let root = $state<HTMLElement | null>(null);

	const trimmed = $derived(draft.trim());
	const renameDisabled = $derived(busy || trimmed.length === 0);

	function reset(): void {
		error = null;
		busy = false;
	}

	function startRename(): void {
		reset();
		draft = currentTitle;
		face = 'renaming';
	}

	function startDelete(): void {
		reset();
		face = 'deleting';
	}

	async function call(path: string, body?: Record<string, unknown>): Promise<boolean> {
		busy = true;
		error = null;
		try {
			const res = await fetch(path, {
				method: 'POST',
				headers: body === undefined ? undefined : { 'content-type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			const payload = (await res.json()) as { ok: boolean; error?: { code: string; message: string } };
			if (!payload.ok) {
				error = payload.error ?? { code: 'unknown', message: 'the request failed' };
				return false;
			}
			onclose();
			return true;
		} catch {
			error = { code: 'network', message: 'could not reach the host' };
			return false;
		} finally {
			busy = false;
		}
	}

	const confirmRename = () => call(`/api/dsh/workspaces/${encodeURIComponent(workspaceId)}/rename`, { title: trimmed });
	const confirmDelete = () => call(`/api/dsh/workspaces/${encodeURIComponent(workspaceId)}/delete`);

	function onWindowPointerDown(e: MouseEvent): void {
		if (root !== null && e.target instanceof Node && !root.contains(e.target)) onclose();
	}

	function onWindowKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<div class="menu" bind:this={root} data-testid="workspace-actions-menu" role="menu" aria-label={t(m.workspaceActions)}>
	{#if face === 'menu'}
		<button
			type="button"
			class="row"
			role="menuitem"
			data-testid="workspace-action-rename"
			onclick={startRename}
		>{t(m.rename)}</button>
		<button
			type="button"
			class="row danger"
			role="menuitem"
			data-testid="workspace-action-delete"
			onclick={startDelete}
		>{t(m.delete)}</button>
	{:else if face === 'renaming'}
		<div class="pane">
			<input
				type="text"
				data-testid="workspace-rename-input"
				bind:value={draft}
				placeholder={t(m.workspaceTitlePh)}
				aria-label={t(m.newWorkspaceTitle)}
				onkeydown={(e) => { if (e.key === 'Enter' && !renameDisabled) void confirmRename(); }}
			/>
			<div class="row-set">
				<button type="button" class="row" data-testid="workspace-rename-cancel" onclick={() => (face = 'menu')}>{t(m.cancel)}</button>
				<button
					type="button"
					class="row primary"
					data-testid="workspace-rename-confirm"
					disabled={renameDisabled}
					onclick={() => void confirmRename()}
				>{busy ? t(m.renaming) : t(m.rename)}</button>
			</div>
		</div>
	{:else if face === 'deleting'}
		<div class="pane">
			<p class="cost" data-testid="workspace-delete-cost">
				{t(m.workspaceDeleteCost)}
			</p>
			<div class="row-set">
				<button type="button" class="row" data-testid="workspace-delete-cancel" onclick={() => (face = 'menu')}>{t(m.cancel)}</button>
				<button
					type="button"
					class="row danger"
					data-testid="workspace-delete-confirm"
					disabled={busy}
					onclick={() => void confirmDelete()}
				>{busy ? t(m.deleting) : t(m.delete)}</button>
			</div>
		</div>
	{/if}
	{#if error !== null}
		<p class="error" data-testid="workspace-menu-error">{error.code} — {error.message}</p>
	{/if}
</div>

<style>
	/* The popup: elevated card grammar (surface-elevated field, border,
	   radius, shadow) — one menu's width, never the rail's. */
	.menu {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 13rem;
		max-width: 16rem;
		padding: 0.375rem;
		background: var(--color-surface-elevated, #fff);
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.5rem;
		box-shadow: 0 0.5rem 1.25rem rgb(0 0 0 / 15%);
		/* No z-index here: this element is position:static, where z-index
		   is ignored — the host's .menu-anchor (positioned) owns the
		   stacking (2026-09-05 SessionStatus-overlap fix). */
	}

	.row {
		display: block;
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--color-text-primary, #212529);
		font-size: 0.75rem;
		line-height: 1.3;
		text-align: left;
		cursor: pointer;
	}

	.row:hover:not(:disabled),
	.row:focus-visible:not(:disabled) {
		background: var(--color-surface-hover, #e9ecef);
	}

	.row:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* Danger rows — rose text on hover wash (AA on white; the token is
	   the app's standing danger accent). */
	.row.danger {
		color: var(--color-accent-rose, #f43f5e);
	}

	.row.danger:hover:not(:disabled),
	.row.danger:focus-visible:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 12%, transparent);
	}

	.row.primary {
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 60%, #1e3a8a);
		font-weight: 600;
	}

	.pane {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.pane input {
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.375rem;
		font-size: 0.75rem;
		color: var(--color-text-primary, #212529);
		background: var(--color-surface-elevated, #fff);
	}

	.row-set {
		display: flex;
		justify-content: flex-end;
		gap: 0.25rem;
	}

	/* The honest cost (ADR D2): the one place delete's semantics are
	   stated before the click is spent. */
	.cost {
		margin: 0;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--color-text-secondary, #6c757d);
	}

	.error {
		margin: 0;
		font-size: 0.6875rem;
		color: var(--color-accent-rose, #f43f5e);
	}
</style>
