<script lang="ts">
	/**
	 * ToolCallChip — the CHIP only (OCI ChipButton pattern + popup split,
	 * 2026-08-22): [chevron icon] plain tool name + status dot. Expanding
	 * no longer renders detail inline — the page shows a ChipPopup after
	 * the row (never pushes same-row chips). Detail lives in
	 * ToolCallDetail.
	 *
	 * Status: dot fill follows OCI statusConfig (emerald pass / red fail /
	 * amber pending); fail keeps the red chip skin.
	 */
	import { ChevronDown, ChevronRight } from '@lucide/svelte';

	interface Props {
		kind: 'call' | 'result' | 'unknown';
		toolName: string;
		summary?: string;
		ok?: boolean;
		status?: 'pending' | 'pass' | 'fail';
		durationMs?: number;
		argsRaw?: string;
		resultText?: string;
		/** Popup split: expanded state is OWNED BY THE PAGE now. */
		open?: boolean;
		ontoggle?: () => void;
	}

	let { kind, toolName, summary, ok, status, durationMs, argsRaw, resultText, open = false, ontoggle }: Props =
		$props();

	// POC-3 W2 (task 2.5, BC-F): call rows carry the DSH variant title
	// (Bash/Read/Write/Edit/Search/Code; unknown → `Tool call`) — one chip
	// per call owns the whole row (status + duration + args + result).
	const label = $derived.by(() => {
		if (kind === 'call') return toolName.length > 0 ? toolName : 'tool';
		if (kind === 'result') return `result · ${toolName} · ${ok ? 'ok' : 'error'}`;
		return `event · ${toolName}`;
	});

	// OCI statusConfig parity (status-config.ts): dot = status color fill.
	const dotClass = $derived.by(() => {
		if (kind === 'call') {
			if (status === 'pass') return 'bg-emerald-500';
			if (status === 'fail') return 'bg-red-500';
			return 'bg-amber-400'; // pending
		}
		if (kind === 'result') return ok === false ? 'bg-red-500' : 'bg-emerald-500';
		return 'bg-slate-400';
	});
</script>

<div class="self-start text-xs" data-testid="tool-chip" data-kind={kind} data-status={status}>
<button
	type="button"
	onclick={() => ontoggle?.()}
	aria-expanded={open}
	data-testid="tool-chip-toggle"
	class="chip-button inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-mono font-medium
			mx-0.5 my-0.5 align-middle shrink-0 transition-colors select-none cursor-pointer
			{kind === 'result' && ok === false
				? 'bg-red-50 text-red-700 border border-red-200'
				: kind === 'result'
					? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
					: status === 'fail'
						? 'bg-red-50 text-red-700 border border-red-200'
						: open
							? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
							: 'bg-surface-alt text-text-secondary border border-surface-border hover:bg-surface-hover hover:text-text-primary'}"
>
	{#if open}
		<ChevronDown size={10} />
	{:else}
		<ChevronRight size={10} />
	{/if}
	<span class="text-[10px]">{label}</span>
	<span
		aria-hidden="true"
		data-testid="tool-chip-dot"
		class="w-1.5 h-1.5 shrink-0 rounded-full {dotClass}"
	></span>
</button>

</div>
<style>
	.chip-button :global(svg) {
		color: var(--color-accent-purple);
	}
</style>
