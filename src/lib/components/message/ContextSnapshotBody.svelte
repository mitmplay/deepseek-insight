<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';
	import { snapshotSectionsOf } from '$lib/utils/context-chip';

	/**
	 * ContextSnapshotBody — the expanded body of a context chip (ADR "The
	 * Section Split", D2/D4): for a runtime-context snapshot whose wire
	 * `sections` parse all-or-nothing, the supersedes caption plus one
	 * text-node block per section (the producer's own boundaries — DSH
	 * ContextBody parity). Anything unreadable falls back to today's
	 * markdown body over the joined text, so every other producer and every
	 * malformed record renders byte-identically to the pre-split chip.
	 *
	 * XSS posture: section names and text render as TEXT nodes only
	 * (BC-12 — no {@html}); markdown syntax inside a section shows raw.
	 */
	let {
		text,
		metaSource
	}: {
		/** The joined wire text — the fallback body's source. */
		text: string;
		/** The entry's verbatim wire source (may carry `sections`). */
		metaSource?: Record<string, unknown>;
	} = $props();

	const sections = $derived(snapshotSectionsOf(metaSource));
</script>

{#if sections}
	<p
		data-csb={"s:" + (sections?.length ?? "none") + ";src:" + JSON.stringify(metaSource ?? null)}
		data-testid="context-snapshot-supersedes"
		class="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-accent-purple/80"
	>
		{t(m.ctxSnapshotSupersedes)}
	</p>
	<div data-testid="context-sections" class="flex flex-col gap-1.5">
		{#each sections as section (section.name)}
			<div class="rounded-md border border-slate-500/15 bg-slate-500/5 p-1.5" data-testid="context-section">
				<span class="font-mono text-[10px] font-medium text-accent-purple">{section.name}</span>
				<p class="mt-0.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-text-secondary">{section.text}</p>
			</div>
		{/each}
	</div>
{:else}
	<MarkdownContent content={text} small hideToggle />
{/if}
