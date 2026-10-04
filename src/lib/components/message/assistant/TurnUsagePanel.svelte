<!--
	TurnUsagePanel — the assistant turn's token-usage pill and popup (DSH
	TurnUsagePanel parity, 2026-09-09): a `Usage {total} tok` button that
	click-opens a small dialog with the turn's Provider / model, Cache
	hit, Uncached input, Cached input, and Output (+ reasoning note).

	All figures are PER-TURN: the sum over the turn's assistant-message
	usage records (turn-grouping turnUsage). Host-owned placement rides
	`class` (AssistantTurn anchors it bottom-LEFT — the pre-2026-09-09
	RelativeTime seat). data-testid="turn-usage" + "turn-usage-popup"
	carry the transcript's test hooks. Outside pointerdown and Escape
	close the popup.
-->
<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { DsiTokenUsage } from '$lib/types';

	let { usage, class: className = '' }: { usage: DsiTokenUsage; class?: string } = $props();

	let open = $state(false);
	let rootEl: HTMLSpanElement | undefined = $state();

	function onoutside(event: PointerEvent): void {
		if (open && rootEl !== undefined && !rootEl.contains(event.target as Node)) open = false;
	}
	function onkey(event: KeyboardEvent): void {
		if (event.key === 'Escape') open = false;
	}

	$effect(() => {
		document.addEventListener('pointerdown', onoutside);
		document.addEventListener('keydown', onkey);
		return () => {
			document.removeEventListener('pointerdown', onoutside);
			document.removeEventListener('keydown', onkey);
		};
	});

	const exact = (n: number): string => n.toLocaleString('en-US');
	// The Exact Total (ADR-0012): the headline copies the provider-reported
	// exact total when every record carried one (D3 guarantees presence);
	// the bucket sum remains the fallback. The implied cached row (D2)
	// derives the provider's unitemized remainder so rows sum to the
	// headline — display-only, never stored.
	const total = $derived(
		usage.totalTokens ??
			usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + usage.outputTokens
	);
	// Cache-hit denominator: the host's own (prompt = total − output) when
	// the total is present, else the itemized buckets.
	const billedInput = $derived(
		usage.totalTokens !== undefined
			? usage.totalTokens - usage.outputTokens
			: usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
	);
	const cacheHit = $derived(
		usage.cacheReadTokens === undefined || billedInput <= 0
			? null
			: `${Math.round((usage.cacheReadTokens / billedInput) * 1000) / 10}%`
	);
	const impliedCache = $derived(
		usage.cacheReadTokens === undefined && usage.totalTokens !== undefined
			? usage.totalTokens - usage.outputTokens - usage.inputTokens - (usage.cacheWriteTokens ?? 0)
			: undefined
	);
	const routes = $derived(
		(usage.routes ?? (usage.provider !== undefined && usage.model !== undefined
			? [{ provider: usage.provider, model: usage.model }]
			: []
		))
			.map((r) => `${r.provider}/${r.model}`)
			.join(', ')
	);
</script>

<span class={className} bind:this={rootEl} data-testid="turn-usage">
	<button
		type="button"
		class="inline cursor-pointer rounded border-none bg-transparent p-0 align-bottom font-inherit text-[10px] leading-none text-text-muted/60 hover:text-text-muted group-hover/bubble:text-[#7c3aed] hover:group-hover/bubble:text-[#7c3aed]"
		onclick={() => (open = !open)}
		aria-haspopup="dialog"
		aria-expanded={open}
	>
		{t(m.usage)} {exact(total)} tok
	</button>
	{#if open}
		<div
			class="absolute bottom-full left-0 z-30 mb-1 w-max min-w-44 max-w-72 rounded-md border border-surface-border bg-surface-elevated px-2.5 py-2 text-[11px] shadow-md"
			role="dialog"
			aria-label={t(m.turnTokenUsage)}
			data-testid="turn-usage-popup"
		>
			<div class="mb-1 flex items-center justify-between gap-3 font-semibold text-text-primary">
				<span>{t(m.turnUsage)}</span>
				<span class="font-normal text-text-secondary">{exact(total)}</span>
			</div>
			<dl class="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-text-secondary">
				{#if routes !== ''}
					<dt>{t(m.providerModel)}</dt>
					<dd class="m-0 text-right break-all" title={routes}>{routes}</dd>
				{/if}
				{#if cacheHit !== null}
					<dt>{t(m.cacheHit)}</dt>
					<dd class="m-0 text-right">{cacheHit}</dd>
				{/if}
				<dt>{t(m.uncachedInput)}</dt>
				<dd class="m-0 text-right whitespace-nowrap">{exact(usage.inputTokens)} tok</dd>
				{#if usage.cacheReadTokens !== undefined}
					<dt>{t(m.cachedInput)}</dt>
					<dd class="m-0 text-right whitespace-nowrap">{exact(usage.cacheReadTokens)} tok</dd>
				{:else if impliedCache !== undefined && impliedCache > 0}
					<!-- Implied, never provider-reported: provenance stays visible (ADR-0012 D2). -->
					<dt>
						{t(m.cachedInput)}
						<span class="text-text-muted/60" title={t(m.impliedNote)}>{t(m.impliedMarker)}</span>
					</dt>
					<dd class="m-0 text-right whitespace-nowrap">~{exact(impliedCache)} tok</dd>
				{/if}
				<dt>{t(m.output)}</dt>
				<dd class="m-0 text-right whitespace-nowrap">
					{exact(usage.outputTokens)} tok
					{#if usage.reasoningTokens !== undefined}
						<span class="text-text-muted/60">({exact(usage.reasoningTokens)} reasoning)</span>
					{/if}
				</dd>
			</dl>
		</div>
	{/if}
</span>
