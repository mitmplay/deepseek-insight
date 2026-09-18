<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { onMount } from 'svelte';

	/**
	 * LoadOlderSentinel — the transcript's history pagination trigger
	 * (POC-2 W3; AUTO-LOAD 2026-08-24): an invisible sentinel row above
	 * the transcript that loads the next older ledger page itself as it
	 * approaches the viewport top — no button, no click, history just
	 * scrolls in (BC-4: pages arrive via session.history {beforeSeq}).
	 *
	 *   observer armed   → nothing rendered while idle; a muted
	 *                      "Loading…" whisper while a page is in flight
	 *   fetch failed     → error line + a manual Retry button (auto-load
	 *                      halts on failure — silence never retries)
	 *   observer dead    → the legacy "Load older" button (environments
	 *                      whose IntersectionObserver never fires, e.g.
	 *                      happy-dom test DOMs — the manual path stays)
	 *
	 * The trigger re-fires whenever a load settles while the sentinel is
	 * still visible (short transcripts fill page by page until the
	 * viewport is full); hasMore=false or leaving the viewport stops it.
	 */
	let {
		hasMore,
		loadingOlder,
		olderError,
		onload
	}: {
		/** Ledger says older pages exist (W3 sentinel gate) — optional only
		 * because the page's cold-load projection marks it optional. */
		hasMore: boolean | undefined;
		/** A page fetch is in flight — button locks into "Loading…". */
		loadingOlder: boolean;
		/** Last page-fetch failure, verbatim (cleared on success). */
		olderError: string | null | undefined;
		/** Load one older page. */
		onload: () => void | Promise<void>;
	} = $props();

	let rootEl: HTMLDivElement | undefined = $state();
	/** The observer has delivered at least one callback — it is alive. */
	let ioAlive = $state(false);
	/** Sentinel currently intersects the viewport (600px lead). */
	let visible = $state(false);

	onMount(() => {
		if (typeof IntersectionObserver === 'undefined' || !rootEl) return;
		const io = new IntersectionObserver(
			(entries) => {
				ioAlive = true;
				visible = entries.at(-1)?.isIntersecting ?? false;
			},
			// Lead distance: start fetching before the user reaches the
			// very top, so the page usually lands before the scroll does.
			{ rootMargin: '600px' }
		);
		io.observe(rootEl);
		return () => io.disconnect();
	});

	// Auto-load: fire whenever the runway is clear — armed + visible +
	// pages remain + nothing in flight + no error standing. Every load
	// completion (loadingOlder false again) re-evaluates: still visible
	// → next page (fill-the-viewport); a failure parks it at Retry.
	$effect(() => {
		if (!ioAlive || !visible) return;
		if (!hasMore || loadingOlder || olderError) return;
		void onload();
	});
</script>

{#if hasMore}
	<div class="flex justify-center py-2" bind:this={rootEl} data-testid="load-older-sentinel">
		{#if olderError}
			<button
				type="button"
				class="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
				disabled={loadingOlder}
				data-testid="load-older-button"
				onclick={() => void onload()}
			>
				{loadingOlder ? t(m.loading) : t(m.retry)}
			</button>
		{:else if !ioAlive}
			<button
				type="button"
				class="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
				disabled={loadingOlder}
				data-testid="load-older-button"
				onclick={() => void onload()}
			>
				{loadingOlder ? t(m.loading) : t(m.loadOlder)}
			</button>
		{:else if loadingOlder}
			<span class="text-xs text-text-muted" data-testid="load-older-loading">{t(m.loading)}</span>
		{/if}
	</div>
{/if}
{#if olderError}
	<p data-testid="load-older-error" class="text-center text-xs text-red-600">{olderError}</p>
{/if}
