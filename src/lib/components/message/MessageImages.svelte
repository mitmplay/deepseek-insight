<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * MessageImages (task 3.4) — the echo gallery on user prompts. Renders
	 * the ledger’s durable image REFS through the per-session URL cache
	 * (BC-A5: from the ledger, never from the browser draft). One slot per
	 * ref: cache hit renders immediately; a miss resolves through the
	 * authorized proxy; a failed read renders an honest failure card —
	 * never a silently broken img.
	 *
	 * Mounted by PromptBubble as a SIBLING ABOVE the bubble (2026-08-28):
	 * the parent column's gap owns the gallery↔bubble rhythm, so the
	 * gallery itself carries no spacing margin.
	 */
	import type { DsiImageRef } from '$lib/types';
	import { resolveAttachmentUrl } from '$lib/services/conversation/attachment-urls.svelte';

	let {
		refs = [],
		sessionId
	}: {
		/** Durable refs from the message’s image blocks, in order. */
		refs?: DsiImageRef[];
		/** Owning session — the read’s authorization scope. */
		sessionId: string;
	} = $props();

	/** Per-slot render state, keyed by attachmentId. */
	let slots = $state<Record<string, { url?: string; failed?: boolean }>>({});
	/** Non-reactive: ids whose read already failed — the effect must never
	 *  read its own output state (that loops); a settled failure stays put. */
	const settledFailed = new Set<string>();

	$effect(() => {
		void refs;
		void sessionId;
		for (const ref of refs) {
			if (settledFailed.has(ref.attachmentId)) continue;
			void resolveAttachmentUrl(sessionId, ref.attachmentId)
				.then((url) => {
					slots = { ...slots, [ref.attachmentId]: { url } };
				})
				.catch(() => {
					settledFailed.add(ref.attachmentId);
					slots = { ...slots, [ref.attachmentId]: { failed: true } };
				});
		}
	});
</script>

{#if refs.length > 0}
	<div class="flex flex-wrap justify-end gap-1.5" data-testid="message-images" role="list" aria-label={t(m.attachedImages)}>
		{#each refs as ref (ref.attachmentId)}
			{#if slots[ref.attachmentId]?.url}
				<img
					src={slots[ref.attachmentId]!.url}
					alt={ref.name ?? 'attached image'}
					class="max-h-48 max-w-[16rem] rounded-lg border border-slate-300 object-contain"
					data-testid="message-image"
					loading="lazy"
				/>
			{:else if slots[ref.attachmentId]?.failed}
				<div
					role="alert"
					data-testid="message-image-failed"
					class="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600"
				>
					<span>Image unavailable — the read was refused{ref.name ? ' (' + ref.name + ')' : ''}</span>
				</div>
			{:else}
				<div
					data-testid="message-image-loading"
					class="h-16 w-24 animate-pulse rounded-lg border border-slate-200 bg-slate-100"
					aria-label="Loading image"
				></div>
			{/if}
		{/each}
	</div>
{/if}
