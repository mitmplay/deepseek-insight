<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * SystemPromptChip — the transcript's "System prompt" disclosure
	 * (2026-09-01): the request/header epoch's rendered system prompt
	 * (`header.system`) as a collapsed pill. DSH's own Chat renders the same
	 * disclosure from the same log-only event (its request-prompt node →
	 * SystemPromptRow); DSI classified the whole event type as SILENT
	 * bookkeeping until now, which is why the row never appeared.
	 *
	 * The body is MODEL-FACING text, not markdown: real line breaks in a
	 * pre-formatted block (DSH OpaqueBody parity — markdown would reflow the
	 * wire's exact bytes), rendered as text nodes only (BC-12, no {@html}).
	 *
	 * Open state is page-owned (the shared `openChipId` exclusivity) like
	 * every context chip; unlike the injection chips the body renders
	 * INLINE below the pill — the system prompt never shares a chip row,
	 * so the popup-after-row split buys nothing here.
	 */
	import { ChevronDown, ChevronRight, Cog } from '@lucide/svelte';

	let {
		text,
		open = false,
		ontoggle
	}: {
		/** Wire: request/header.data.header.system — complete prompt text. */
		text: string;
		open?: boolean;
		ontoggle?: () => void;
	} = $props();
</script>

<div class="text-xs" data-testid="system-prompt-chip" data-open={open}>
	<button
		type="button"
		onclick={() => ontoggle?.()}
		aria-expanded={open}
		data-testid="system-prompt-toggle"
		aria-label={t(m.systemPrompt)}
		class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-mono font-medium max-w-full
			mx-0.5 my-0.5 align-middle shrink-0 transition-colors select-none cursor-pointer
			{open
				? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/30'
				: 'bg-slate-500/10 text-text-secondary border border-slate-500/20 hover:bg-slate-500/20 hover:text-text-primary'}"
	>
		{#if open}
			<ChevronDown size={10} />
		{:else}
			<ChevronRight size={10} />
		{/if}
		<Cog size={10} aria-hidden="true" />
		<span class="truncate text-[10px]">{t(m.systemPrompt)}</span>
	</button>
	{#if open}
		<div
			data-testid="system-prompt-body"
			class="mt-1 rounded-md border border-slate-500/20 bg-slate-500/5 p-2"
		>
			<pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-text-secondary">{text}</pre>
		</div>
	{/if}
</div>
