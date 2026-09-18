<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * ForkHereButton — the fork-here mark in an assistant turn's hover
	 * action row (The Fork-Here Button ADR, 2026-09-02). A thin shell over
	 * the shared fork spine: POSTs with the turn's ANCHOR (atSeq = the
	 * turn's first entry seq), so the host cuts at that turn's end — the
	 * child inherits everything through the chosen turn, not the session's
	 * tail. Placement, rename, and the off-floor fallback are the spine's;
	 * the shell owns only its busy lock.
	 *
	 * Reports nothing upward except refusal text through `onrefusal` — the
	 * host's message is the truth, and the mounting turn owns the
	 * transient chip (a hover row has no standing place to print).
	 *
	 * Lens disable (The Panel Loupe ADR D8, 2026-09-04): inside the
	 * loupe the button renders visible-disabled beside its busy lock —
	 * fork placement is a floor verb.
	 */
	import { GitBranch } from '@lucide/svelte';
	import { forkFromSession } from '$lib/services/conversation/fork-session';
	import { getLensMode } from '$lib/services/conversation/lens-context.svelte';

	let {
		sessionId,
		atSeq,
		title = null,
		agentPreset = null,
		onrefusal,
		class: className = ''
	}: {
		/** The source session — the fork's cut source. */
		sessionId: string;
		/** The turn's anchor — its first entry's wire seq; the host cuts at
		 *  the first turn/end at or after it (the anchor's own turn). */
		atSeq: number;
		/** Live source title — seeds the child's best-effort " (fork)"
		 *  rename (the spine's contract). */
		title?: string | null;
		/** Raw preset id carried onto the opened child panel's chip. */
		agentPreset?: string | null;
		/** Verbatim refusal/failure text — the bubble's transient chip
		 *  shows it; absent, failures stay silent (the view never lies). */
		onrefusal?: (message: string) => void;
		/** Row-chip styling — the mount supplies the row's shared classes. */
		class?: string;
	} = $props();

	/** One fork at a time per button (the ForkButton lock pattern). */
	let forking = $state(false);
	/** Lens flag (ADR D8), read once at init — a fork never fires from
	 *  inside the loupe. */
	const lens = getLensMode();

	async function fork(): Promise<void> {
		if (forking) return;
		forking = true;
		try {
			const outcome = await forkFromSession({ sessionId, atSeq, title, agentPreset });
			if (!outcome.ok) onrefusal?.(outcome.message);
		} finally {
			forking = false;
		}
	}
</script>

<button
	type="button"
	class="shrink-0 disabled:cursor-not-allowed disabled:opacity-50 {className}"
	disabled={lens || forking}
	data-testid="fork-here-button"
	aria-label={t(m.forkFromTurn)}
	title={t(m.forkFromTurnLong)}
	onclick={() => void fork()}
>
	{#if forking}
		<span class="text-[10px] leading-none">…</span>
	{:else}
		<GitBranch size={12} aria-hidden="true" />
	{/if}
</button>
