<!--
	MarkdownContent — shared markdown renderer (OCI port, 2026-08-22).

	OCI structure, DSI rendering rule: the {@html} sink is fed EXCLUSIVELY
	by renderMarkdown (BC-12 escape-first allow-list pipeline) — no marked,
	no highlight.js. Those are OCI dependencies DSI deliberately does not
	carry; the escape-first subset covers the harness-transcript subset
	pinned by markdown.test.ts.

	Mermaid (2026-08-23): a ```mermaid fence renders as a placeholder div
	(see markdown.ts); this component swaps the SVG in — OCI's render pass,
	better loading: the mermaid runtime (~1.4 MB) is LAZY-imported on the
	first diagram only, code-split off the main bundle (OCI imports it
	statically). The pass is browser-gated so unit tests never load it.
	Table canvas copy (2026-09-05): the HTML arrives as a string, so each
	rendered table gets its hover-revealed CanvasCopyButton through a
	post-render DOM pass (the mermaid pass's pattern): the table is wrapped
	in a relative div and a small image button floats at its top-left.
	Click copies the table as PNG; Shift+Click saves the file.

	Two paths (OCI contract):
	  full    — relative wrapper; when the content looks like markdown, a
	            hover-revealed Copy/Raw pair sits top-right
	  lean    — hideToggle: bare .md-content div, hosts that render their
	            own action row (PromptBubble does)
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { browser } from '$app/environment';
	import { mount, unmount } from 'svelte';
	import { renderMarkdown } from '$lib/utils/markdown';
	import { isFileLinkHref, normalizeFileLinkPath } from '$lib/utils/file-link';
	import CanvasCopyButton from '$lib/components/common/buttons/CanvasCopyButton.svelte';
	import CopyButton from '$lib/components/common/buttons/CopyButton.svelte';
	import RawPreviewToggle from '$lib/components/common/viewers/RawPreviewToggle.svelte';

	let {
		content,
		small = false,
		hideToggle = false,
		searchTerm = '',
		onFileLink = undefined
	}: {
		content: string;
		small?: boolean;
		hideToggle?: boolean;
		searchTerm?: string;
		/** File Link Intent (ADR 2026-09-25 D2): when set, clicks on scheme-free
		 *  relative anchors are intercepted (preventDefault) and forwarded as
		 *  workspace-relative paths. Absent = anchors navigate as today. */
		onFileLink?: (path: string) => void;
	} = $props();

	let showRaw = $state(false);
	let containerEl: HTMLDivElement | null = $state(null);

	/** Sanitized HTML — BC-12: allow-listed tags only (never raw input). */
	let renderedHtml = $derived(renderMarkdown(content));

	/** Highlight search term in rendered HTML — AFTER markdown rendering. */
	let highlightedHtml = $derived.by(() => {
		if (!searchTerm.trim()) return renderedHtml;
		const term = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		try {
			const regex = new RegExp(`(?<![<\\w/])(${term})(?![\\w>])`, 'gi');
			return renderedHtml.replace(regex, '<mark class="bg-accent-blue/30 rounded px-0.5">$1</mark>');
		} catch {
			return renderedHtml;
		}
	});

	let textSize = $derived(small ? 'text-xs' : 'text-sm');

	/** Cheap markdown-lookahead so plain text mounts stay lean (OCI parity). */
	let hasMarkdown = $derived(
		content.includes('`') ||
			content.includes('```') ||
			content.includes('#') ||
			content.includes('**') ||
			content.includes('>')
	);

	/** A diagram is waiting only when a mermaid fence is present. */
	let hasMermaid = $derived(/^```mermaid\b/m.test(content));

	/** Mermaid runtime, lazy — the heavy chunk loads on first diagram only. */
	let mermaidMod: Promise<typeof import('mermaid')> | null = null;
	let mermaidReady = false;
	/** Mounted per-element copy buttons — unmounted on every content change
	 *  (the {@html} swap discards their host DOM; Svelte must hear it). */
	let copyDisposers: (() => void)[] = [];

	/** Complete literal class pairs (Tailwind 4 scans whole names only). */
	const TABLE_COPY_CLASSES = {
		wrap: 'group/table relative',
		host: 'absolute top-0 left-0 opacity-0 group-hover/table:opacity-100 transition-opacity'
	} as const;
	const DIAGRAM_COPY_CLASSES = {
		wrap: 'group/diagram relative',
		host: 'absolute top-0 left-0 opacity-0 group-hover/diagram:opacity-100 transition-opacity'
	} as const;

	/** Wrap one rendered element in a relative div with a hover-revealed
	 *  canvas-copy button at its top-left. Returns the disposer that
	 *  unmounts the button and unwraps the element.
	 *
	 *  The two class pairs are passed as COMPLETE literals, never built by
	 *  concatenation: Tailwind 4's automatic content detection scans source
	 *  text for whole utility names — a 'group-hover/' + group + ':opacity'
	 *  concat leaves only fragments in the source, so the hover utilities
	 *  are never generated and the button stays opacity-0 forever (the
	 *  2026-09-05 regression this signature exists to prevent). */
	function attachCopyButton(
		el: HTMLElement,
		classes: { wrap: string; host: string },
		title: string
	): () => void {
		const wrap = document.createElement('div');
		wrap.className = classes.wrap;
		const host = document.createElement('div');
		host.className = classes.host;
		el.parentNode?.insertBefore(wrap, el);
		wrap.appendChild(el);
		wrap.appendChild(host);
		const btn = mount(CanvasCopyButton, {
			target: host,
			props: {
				container: el,
				title,
				size: 12,
				class:
					'p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover'
			}
		});
		return () => {
			unmount(btn);
			// Unwrap: the element returns to its place, wrapper and host go.
			wrap.replaceWith(el);
			wrap.remove();
		};
	}

	/** Give every rendered table and mermaid diagram its own canvas-copy
	 *  button (top-left, hover-revealed): each rides inside a relative
	 *  wrapper so the button anchors to its own box, not the whole block.
	 *  The mermaid pass swaps the SVG INSIDE the .mermaid-diagram div, so a
	 *  button attached to the placeholder captures the rendered diagram. */
	$effect(() => {
		// Depend on the HTML so a content change re-runs the pass.
		void highlightedHtml;
		copyDisposers.forEach((dispose) => dispose());
		copyDisposers = [];
		if (!containerEl) return;
		for (const table of Array.from(containerEl.querySelectorAll('table'))) {
			copyDisposers.push(
				attachCopyButton(table, TABLE_COPY_CLASSES, 'Copy table as image (Shift+Click to save)')
			);
		}
		for (const diagram of Array.from(containerEl.querySelectorAll('.mermaid-diagram'))) {
			copyDisposers.push(
				attachCopyButton(
					diagram as HTMLElement,
					DIAGRAM_COPY_CLASSES,
					'Copy diagram as image (Shift+Click to save)'
				)
			);
		}
	});

	/** A feature-spec lead renders as bold 'feature-spec: ' — flag the whole
	 *  block for the top-right canvas copy (2026-09-05). Detected on the
	 *  RENDERED html so both '**feature-spec:' markdown and any future
	 *  allow-listed strong lead land the same button. */
	let hasFeatureSpec = $derived(renderedHtml.includes('<strong>feature-spec: '));

	/** Lean path (hideToggle): hosts render their own action rows, so the
	 *  feature-spec copy button attaches through a small DOM pass — the
	 *  container itself becomes the positioning anchor. Classes are
	 *  complete literals (Tailwind 4 scans whole names only — the
	 *  2026-09-05 concat regression's rule). */
	let featureSpecDispose: (() => void) | null = null;
	$effect(() => {
		featureSpecDispose?.();
		featureSpecDispose = null;
		if (!hideToggle || !containerEl || !hasFeatureSpec) return;
		const mdEl = containerEl;
		mdEl.classList.add('relative', 'group/featurespec');
		const host = document.createElement('div');
		host.className =
			'absolute top-1.5 right-1.5 opacity-0 group-hover/featurespec:opacity-100 transition-opacity';
		containerEl.appendChild(host);
		const btn = mount(CanvasCopyButton, {
			target: host,
			props: {
				container: mdEl,
				title: 'Copy feature spec as image (Shift+Click to save)',
				size: 12,
				class:
					'p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover'
			}
		});
		featureSpecDispose = () => {
			unmount(btn);
			host.remove();
			mdEl.classList.remove('relative', 'group/featurespec');
		};
	});

	/** File Link Intent (ADR 2026-09-25 D2): delegated capture-phase click
	 *  listener. Without the prop this component changes NOTHING — anchors
	 *  keep native navigation. With it, scheme-free relative anchors
	 *  preventDefault and forward the normalized path; everything else
	 *  (external, /api/, '..', escaped) keeps native behavior. */
	$effect(() => {
		const el = containerEl;
		if (!el || !onFileLink) return;
		const onClick = (event: MouseEvent) => {
			const anchor = (event.target as HTMLElement | null)?.closest('a');
			if (!anchor) return;
			const href = anchor.getAttribute('href');
			if (!href || !isFileLinkHref(href)) return;
			const path = normalizeFileLinkPath(href);
			if (path === null) return;
			event.preventDefault();
			onFileLink(path);
		};
		el.addEventListener('click', onClick, true);
		return () => el.removeEventListener('click', onClick, true);
	});

	/** Render every unprocessed placeholder in this container (OCI pass). */
	$effect(() => {
		// Depend on the HTML so a content change re-runs the pass.
		void highlightedHtml;
		if (!browser || !containerEl || !hasMermaid) return;

		const els = containerEl.querySelectorAll<HTMLDivElement>(
			'.mermaid-diagram[data-processed="false"]'
		);
		if (els.length === 0) return;

		let cancelled = false;
		void (async () => {
			mermaidMod ??= import('mermaid');
			const mermaid = (await mermaidMod).default;
			if (!mermaidReady) {
				mermaid.initialize({
					startOnLoad: false,
					theme: 'neutral',
					securityLevel: 'strict',
					fontFamily: 'ui-monospace, monospace'
				});
				mermaidReady = true;
			}
			for (const el of Array.from(els)) {
				if (cancelled) return;
				const encoded = el.dataset.source;
				if (!encoded) continue;
				const source = new TextDecoder().decode(
					Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
				);
				try {
					const id = `mmd-${Math.random().toString(36).slice(2, 8)}`;
					const { svg } = await mermaid.render(id, source);
					el.innerHTML = svg;
					el.setAttribute('data-processed', 'true');
				} catch (err) {
					el.innerHTML = `<div class="text-xs text-red-600 p-2 border border-red-500/30 rounded bg-red-500/10">Mermaid render error: ${String(err).split('\n')[0]}</div>`;
					el.setAttribute('data-processed', 'true');
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	});
</script>

{#if hideToggle}
	<!-- Lean path: no wrapper div, no toggle UI -->
	<div class="md-content {textSize} leading-relaxed break-words" bind:this={containerEl}>
		<!-- eslint-disable-next-line svelte/no-at-html-tags — BC-12: sanitized util output only -->
		{@html highlightedHtml}
	</div>
{:else}
	<!-- Full path: with relative wrapper for toggle button -->
	<div class="relative group/markdown">
		{#if showRaw}
			<pre
				class="{textSize} leading-relaxed whitespace-pre-wrap break-words font-mono text-text-secondary"
				data-testid="markdown-raw"
			>{content}</pre>
		{:else}
			<div class="md-content {textSize} leading-relaxed break-words" bind:this={containerEl}>
				<!-- eslint-disable-next-line svelte/no-at-html-tags — BC-12: sanitized util output only -->
				{@html highlightedHtml}
			</div>
		{/if}

		{#if hasMarkdown || hasFeatureSpec}
			<div
				class="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover/markdown:opacity-100 transition-opacity"
			>
				{#if hasFeatureSpec}
					<CanvasCopyButton
						container={containerEl}
						title={t(m.copySpecImage)}
						size={12}
						class="p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover"
					/>
				{/if}
				{#if hasMarkdown}
					<CopyButton
						value={content}
						title={t(m.copyMarkdown)}
						size={12}
						class="p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover"
					/>
					<RawPreviewToggle bind:showRaw />
				{/if}
			</div>
		{/if}
	</div>
{/if}
