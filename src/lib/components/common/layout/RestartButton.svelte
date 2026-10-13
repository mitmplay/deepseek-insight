<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { onMount } from 'svelte';
	import { Power } from '@lucide/svelte';

	/**
	 * RestartButton — the Restart Verb trigger (ADR 2026-10-12): POSTs the
	 * floor restart route, then polls through the blackout (the server may
	 * die before answering) and reloads the page when the floor answers
	 * again. Self-contained like AboutButton: trigger, state, and the
	 * poll/reload travel together; `class` passthrough lets a host layer
	 * its own ink (AppSidebar's rail-collapsed-label).
	 */
	let { class: passthroughClass = '' }: { class?: string } = $props();

	let restarting = $state(false);

	/**
	 * Dev-only gate (2026-10-13): the Restart Verb only exists on a dev
	 * floor (DSI_DEV=1, stamped by the launcher — bin/lib/dev-mode.mjs),
	 * so the button asks GET /api/floor/mode once on mount and stays
	 * hidden on build floors. Hidden BY DEFAULT: a production floor
	 * (or a dead fetch) never flashes the trigger.
	 */
	let isDev = $state(false);
	onMount(() => {
		fetch('/api/floor/mode', { cache: 'no-store' })
			.then((r) => (r.ok ? r.json() : { dev: false }))
			.then((body: { dev?: boolean }) => {
				isDev = body.dev === true;
			})
			.catch(() => {
				// floor unreachable — stay hidden, the verb is dev-only anyway
			});
	});

	async function restartFloor(): Promise<void> {
		if (restarting) return;
		restarting = true;
		try {
			await fetch('/api/floor/restart', { method: 'POST' });
		} catch {
			// the server may die before the answer lands — the poll decides
		}
		const deadline = Date.now() + 120_000;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 1500));
			try {
				const res = await fetch('/api/plugins/snapshot', { cache: 'no-store' });
				if (res.ok) {
					location.reload();
					return;
				}
			} catch {
				// floor still down — keep polling
			}
		}
		restarting = false; // timeout: let the operator retry
	}
</script>

{#if isDev}
<button
	type="button"
	class="restart-trigger {passthroughClass}"
	data-testid="sidebar-restart-trigger"
	aria-label={t(m.floorRestart)}
	title={t(m.floorRestart)}
	onclick={() => void restartFloor()}
	disabled={restarting}
>
	<Power size={12} />
</button>
{/if}

<style>
	.restart-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 18px;
		height: 18px;
		color: var(--color-slate-neutral);
		background: color-mix(in srgb, var(--color-surface-elevated) 55%, transparent);
		border: 1.5px solid var(--color-border, #d0d7de);
		border-radius: 9999px;
		cursor: pointer;
		transition: color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
	}
	.restart-trigger:hover:not(:disabled),
	.restart-trigger:focus-visible:not(:disabled) {
		color: var(--color-accent-deep);
		border-color: var(--color-accent-deep);
		box-shadow: 0 0 0 2px rgb(139 92 246 / 0.25);
		outline: none;
	}
	.restart-trigger:disabled {
		opacity: 0.5;
		cursor: wait;
	}
</style>
