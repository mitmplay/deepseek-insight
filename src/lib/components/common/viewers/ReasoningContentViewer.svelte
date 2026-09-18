<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * ReasoningContentViewer — the assistant's reasoning body (extracted
	 * from InlineToolCalls' think popup, 2026-09-05). Markdown renders
	 * through the same escape-first allow-list pipeline (BC-12: the
	 * {@html} sink is fed exclusively by renderMarkdown). The hover-revealed
	 * Copy pair top-right (MarkdownContent's OCI-parity contract) copies
	 * the RAW reasoning text — the markdown source, not the rendered HTML.
	 *
	 * Presentational — one prop; the host owns the popup chrome and the
	 * stick-to-bottom scroller.
	 */
	import { renderMarkdown } from '$lib/utils/markdown';
	import CopyButton from '$lib/components/common/buttons/CopyButton.svelte';

	let {
		content,
		small = false
	}: { content: string; small?: boolean } = $props();

	/** Sanitized HTML — BC-12: allow-listed tags only (never raw input). */
	let renderedHtml = $derived(renderMarkdown(content));
</script>

<div class="group/reasoning relative p-3 {small ? 'text-xs' : 'text-[12px]'} leading-relaxed text-text-secondary" data-testid="reasoning-body">
	<div class="whitespace-pre-wrap break-words">
		<!-- eslint-disable-next-line svelte/no-at-html-tags — BC-12: sanitized util output only -->
		{@html renderedHtml}
	</div>

	<div
		class="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover/reasoning:opacity-100 transition-opacity"
		data-testid="reasoning-actions"
	>
		<CopyButton
			value={content}
			title={t(m.copyReasoning)}
			size={12}
			class="p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover"
		/>
	</div>
</div>
