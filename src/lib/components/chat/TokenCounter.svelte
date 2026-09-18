<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { estimateTokens } from '$lib/utils/token-estimate';

	/**
	 * TokenCounter — live estimate of the DRAFT's token count (OCI port,
	 * 2026-08-23): "~42 tokens" under the textarea's left corner. The
	 * ~4 chars/token heuristic (estimateTokens util) — display guidance,
	 * never billing truth.
	 */
	let {
		/** Draft text being estimated. */
		text
	}: {
		text: string;
	} = $props();

	const count = $derived(estimateTokens(text));
</script>

<span class="shrink-0 font-mono text-[11px] tabular-nums text-text-muted" data-testid="token-counter" title={t(m.tokenCounterTitle)}>
	~{count} tokens
</span>
