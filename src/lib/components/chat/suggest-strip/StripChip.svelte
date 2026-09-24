<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * StripChip — one suggestion row of the strip (ADR D8; ported from
	 * OCI's StripChip + StripPick + StripLabel + StripMenu +
	 * StripMenuPopup, merged into ONE component per the DSI Module Map —
	 * "merge OCI's StripPick/StripMenu into the chip"; the multiline
	 * preview tooltip stayed its own StripTip component).
	 *
	 * Presentational: row + active flag + live query in, pick/rename/
	 * delete out. SuggestStrip owns exclusive-open coordination via
	 * menuOpen/onmenuopen/onmenuclose, so opening one chip's menu closes
	 * any other. Owns its own popup internals: edit fields prefilled from
	 * the row on mount (the popup only mounts while the menu is open),
	 * textarea sizing, and the body portal. The multiline preview
	 * tooltip renders through StripTip (same body-portal escape); this
	 * chip only hands it the anchor and the live flags.
	 */
	import { previewSegments, type SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';
	import StripTip from './StripTip.svelte';

	let {
		row,
		active = false,
		query = '',
		mode = 'find',
		/** True while this chip's ⋯ menu is open (controlled by SuggestStrip). */
		menuOpen = false,
		/** True while ANY chip's ⋯ menu is open — hides the preview tooltip. */
		anyMenuOpen = false,
		onpick,
		onstep = undefined,
		onrename = undefined,
		ondelete = undefined,
		/** Esc in the popup: host refocuses the prompt textarea. */
		onclose,
		/** ⋯ clicked — strip opens this chip's menu (and closes any other). */
		onmenuopen,
		/** Popup closed itself (Save/Delete/Esc) — strip clears menuForId. */
		onmenuclose
	}: {
		row: SuggestedPrompt;
		active?: boolean;
		/** Live trigger query for preview highlighting (F4) — see SuggestStrip. */
		query?: string;
		/** 'run' renders the ⏯ Step button (Prompt Macro D10); 'find' hides it. */
		mode?: 'find' | 'run';
		menuOpen?: boolean;
		anyMenuOpen?: boolean;
		onpick: () => void;
		/** ⏯ Step — start this row held (run mode only). */
		onstep?: () => void;
		/** ⋯ menu handlers — both absent hides the ⋯ toggle (a pick-only
		 *  strip, e.g. the broadcast box's view, shows no dead controls). */
		onrename?: (row: SuggestedPrompt, fields: { uses: string; label: string; text: string }) => void;
		ondelete?: (row: SuggestedPrompt) => void;
		onclose?: () => void;
		onmenuopen: (id: number) => void;
		onmenuclose: () => void;
	} = $props();

	/** The ⋯ menu exists only when both of its handlers do. */
	const hasMenu = $derived(onrename !== undefined && ondelete !== undefined);

	/** Chip root — anchor for the multiline preview tooltip and the ⋯ menu. */
	let chipEl = $state<HTMLDivElement | undefined>();

	/** Segments for the current query — recomputed per render (pure service). */
	const segments = $derived(previewSegments(row, query));

	// ── ⋯ menu popup (merged from OCI StripMenu + StripMenuPopup) ──

	/** Popup box; null = hidden. Strip-aligned (user spec 2026-08-15,
	 *  ported): same left edge and width as the host .suggest-strip, top
	 *  at the chip row so translateY(-100%) opens the popup just above it
	 *  (below is off-screen — the strip already sits above the textarea). */
	let menuPos = $state<{ x: number; y: number; w: number } | null>(null);
	let popEl = $state<HTMLDivElement | undefined>();

	/** Edit form state — prefilled from the row when the popup mounts.
	 *  svelte-ignore state_referenced_locally — intentional: the popup is
	 *  behind {#if menuOpen}, so it mounts fresh on every open and
	 *  captures the CURRENT row; it never needs to track row updates. */
	// svelte-ignore state_referenced_locally
	let editLabel = $state(row.label ?? '');
	// svelte-ignore state_referenced_locally
	let editUses = $state(String(row.use_count));
	// svelte-ignore state_referenced_locally
	let editText = $state(row.text);

	function toggleMenu(e: MouseEvent): void {
		if (menuOpen) {
			onmenuclose();
			return;
		}
		// Strip-aligned anchor: same left/width as the host strip, top at
		// the chip row so translateY(-100%) opens the popup just above it.
		const strip = (e.currentTarget as HTMLElement).closest('.suggest-strip');
		const chip = chipEl?.getBoundingClientRect();
		if (strip && chip) {
			const sr = strip.getBoundingClientRect();
			menuPos = { x: Math.max(0, sr.left), y: Math.max(8, chip.top - 4), w: sr.width };
		}
		onmenuopen(row.id);
	}

	/** Portal the ⋯ menu popup to document.body (BC-7): escape the strip's
	 *  overflow clip and any ancestor zoom transform that would rescale
	 *  fixed coords (the panel floor's CSS zoom becomes the containing
	 *  block for position:fixed). */
	$effect(() => {
		if (!popEl) return;
		const el = popEl; // capture: bind:this nulls popEl before cleanup runs
		document.body.appendChild(el);
		return () => {
			el.remove();
		};
	});

	/** Size the text field's HEIGHT to its content — width is fixed by the
	 *  strip-aligned popup, the text never wraps (horizontal scroll
	 *  instead of wrap-down), so height = line count × lineHeight. When
	 *  the longest line exceeds the strip width the h-scrollbar eats ~a
	 *  row — add one extra row so the last line isn't cut off. Re-runs on
	 *  every editText change (typing) so the height follows live. */
	$effect(() => {
		void editText;
		if (!popEl) return;
		const ta = popEl.querySelector<HTMLTextAreaElement>('.strip-menu-text');
		if (!ta) return;
		const cs = getComputedStyle(ta);
		const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
		let hasHScroll = false;
		try {
			const ctx = document.createElement('canvas').getContext('2d');
			if (ctx) {
				ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
				const lines = editText.split('\n');
				const longest = lines.reduce((w, line) => Math.max(w, ctx.measureText(line).width), 0);
				hasHScroll = longest > ta.clientWidth || longest > (menuPos?.w ?? 0);
			}
		} catch {
			/* measurement is best-effort — keep hasHScroll false */
		}
		const extraRow = hasHScroll ? lineHeight : 0;
		const wantedH =
			editText.split('\n').length * lineHeight + extraRow + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 4;
		const maxH = window.innerHeight * 0.7;
		ta.style.height = `${Math.max(48, Math.min(wantedH, maxH))}px`;
		ta.style.overflowY = wantedH > maxH ? 'auto' : 'hidden';
	});

	// Focus the first field (Uses) once, when the popup mounts. Kept in
	// its OWN effect, apart from the sizing one above: that effect also
	// reads editText, so folding this in re-focused the Uses input on
	// every keystroke typed into the Text field (OCI focus-steal bug
	// 2026-08-20 — not ported).
	$effect(() => {
		if (!popEl) return;
		popEl.querySelector<HTMLElement>('.strip-menu-input')?.focus();
	});

	/** Run a menu action and close the popup (PromptInput refetches rows). */
	function menuAction(fn: (row: SuggestedPrompt) => void, r: SuggestedPrompt): void {
		onmenuclose();
		fn(r);
	}
</script>

<div bind:this={chipEl} class="strip-chip" class:active>
	<!-- Pick button (merged from OCI StripPick + StripLabel): option role,
	     aria-selected, full title; content = preview segments + ⏎ badge +
	     ×use_count. -->
	<button
		type="button"
		class="strip-pick"
		role="option"
		aria-selected={active}
		onclick={onpick}
		title={row.text}
	>
		<span class="strip-label" role="presentation">
			{#each segments as seg}
				{#if seg.hit}<span class="hl">{seg.text}</span>{:else}{seg.text}{/if}
			{/each}
		</span>
		{#if row.text.includes('\n')}<span class="strip-ml">⏎</span>{/if}
		<span class="strip-count">×{row.use_count}</span>
	</button>

	<!-- ⏯ Step (Prompt Macro D10, run mode only): a SIBLING of the pick
	     button and OUTSIDE the ⋯ menu — the supervised start (row opens
	     held). click.stopPropagation so the row's own pick (run-all) never
	     fires with it. -->
	{#if mode === 'run' && onstep !== undefined}
		<div class="strip-step">
			<button
				type="button"
				class="strip-step-btn"
				aria-label={t(m.stepThisMacro)}
				title={t(m.stepHeldTitle)}
				onclick={(e) => {
					e.stopPropagation();
				onstep();
				}}
			>⏯</button
			>
		</div>
	{/if}

	<!-- ⋯ menu toggle (merged from OCI StripMenu) — pick-only strips
	     (no rename/delete handlers) render no toggle at all. -->
	{#if hasMenu}
		<div class="strip-menu">
			<button
				type="button"
				class="strip-menu-btn"
				aria-label={t(m.promptOptions)}
				onclick={(e) => {
					e.stopPropagation();
					toggleMenu(e);
				}}>⋯</button>
		</div>
	{/if}

	<!-- Multiline preview tooltip (OCI StripMultiline lineage): StripTip
	     owns the visibility grammar, strip-aligned anchoring, and the
	     body portal; this chip hands it the anchor and the live flags. -->
	<StripTip {active} {menuOpen} {anyMenuOpen} text={row.text} anchor={chipEl} />

	{#if menuOpen && onrename !== undefined && ondelete !== undefined}
		<!-- ⋯ menu popup (merged from OCI StripMenuPopup): edit form
		     (uses/label/text) + Delete, portaled to document.body,
		     strip-aligned, opening above the chip. -->
		<div
			bind:this={popEl}
			class="strip-menu-pop"
			role="menu"
			tabindex="-1"
			style={menuPos
				? `left:${menuPos.x}px; top:${menuPos.y}px; width:${menuPos.w}px; transform:translateY(-100%);`
				: ''}
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					onmenuclose();
					onclose?.();
				}
			}}
		>
			<div class="strip-menu-form">
				<label class="strip-menu-field">
					<span>{t(m.uses)}</span>
					<input
						type="number"
						class="strip-menu-input strip-menu-uses"
						bind:value={editUses}
						min="1"
						aria-label={t(m.uses)}
					/>
				</label>
				<label class="strip-menu-field">
					<span>{t(m.label)}</span>
					<input
						type="text"
						class="strip-menu-input"
						bind:value={editLabel}
						placeholder={t(m.label)}
						maxlength="60"
						aria-label={t(m.promptLabelAria)}
					/>
				</label>
				<label class="strip-menu-field">
					<span>{t(m.text)}</span>
					<textarea class="strip-menu-text" bind:value={editText} aria-label={t(m.promptTextAria)}></textarea>
				</label>
			</div>
			<div class="strip-menu-actions">
				<button
					type="button"
					class="strip-menu-save"
					onclick={() => menuAction((r) => onrename(r, { uses: editUses, label: editLabel, text: editText }), row)}
				>
					{t(m.save)}
				</button>
				<button type="button" class="strip-menu-delete" onclick={() => menuAction(ondelete, row)}>
					{t(m.delete)}
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.strip-chip {
		position: relative;
		display: flex;
		align-items: center;
		/* Full-width row: stretch to the strip's width so the pick + ⋯ span
		   the whole line; flush against neighbors (no gap, no border, no
		   radius — bare rows). */
		width: 100%;
		background: var(--color-surface, #f8f9fa);
		max-width: 100%;
	}
	.strip-chip.active {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 10%, transparent);
	}

	.strip-pick {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		border: none;
		background: transparent;
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-primary, #212529);
		cursor: pointer;
		/* Full-width rows: the chip stretches to the strip width, so a
		   one-liner preview is never cut off on the right — ellipsis still
		   guards the extreme case. */
		max-width: 100%;
		min-width: 0;
		flex: 1;
		text-align: left;
	}

	.strip-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Matched-fragment highlight (F4): accent underline + soft tint.
	   Colors inherit the chip surface — AA-safe on both light/dark tokens. */
	.hl {
		text-decoration: underline;
		text-decoration-style: dotted;
		text-decoration-color: var(--color-accent-blue, #3b82f6);
		text-underline-offset: 2px;
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 14%, transparent);
		border-radius: 2px;
	}

	.strip-ml,
	.strip-count {
		color: var(--color-text-muted, #868e96);
		flex-shrink: 0;
	}

	.strip-menu {
		position: relative;
		flex-shrink: 0;
	}

	/* ⏯ Step (run mode): same flank styling as the ⋯ menu button — a
	   quiet sibling control, not a second primary. */
	.strip-step {
		position: relative;
		flex-shrink: 0;
	}
	.strip-step-btn {
		border: none;
		background: transparent;
		color: var(--color-text-muted, #868e96);
		cursor: pointer;
		padding: 0.125rem 0.25rem;
		font-size: 0.75rem;
		line-height: 1;
	}
	.strip-step-btn:hover {
		color: var(--color-accent-blue, #3b82f6);
	}

	.strip-menu-btn {
		border: none;
		background: transparent;
		color: var(--color-text-muted, #868e96);
		cursor: pointer;
		padding: 0.125rem 0.25rem;
		font-size: 0.75rem;
		line-height: 1;
	}
	.strip-menu-btn:hover {
		color: var(--color-text-primary, #212529);
	}

	/* ⋯ menu popup — fixed to viewport, strip-aligned (left + width set
	   inline from the strip's rect), opening ABOVE the chip. Portaled to
	   document.body. */
	.strip-menu-pop {
		position: fixed;
		z-index: 10001;
		background: var(--color-surface-elevated, #ffffff);
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.375rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		padding: 0.5rem;
	}

	.strip-menu-form {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.strip-menu-field {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		font-size: 0.75rem;
		color: var(--color-text-muted, #868e96);
	}

	.strip-menu-input {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		padding: 0.25rem 0.375rem;
		font-size: 0.75rem;
		background: var(--color-surface-elevated, #ffffff);
		color: var(--color-text-primary, #212529);
	}

	.strip-menu-text {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		padding: 0.25rem 0.375rem;
		font-size: 0.75rem;
		background: var(--color-surface-elevated, #ffffff);
		color: var(--color-text-primary, #212529);
		/* Horizontal scroll instead of wrap-down (user spec 2026-08-15):
		   the text never wraps, the height follows the line count. */
		white-space: nowrap;
		overflow-x: auto;
		resize: none;
		width: 100%;
		box-sizing: border-box;
	}

	.strip-menu-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.strip-menu-save {
		flex: 1;
		border: none;
		border-radius: 0.25rem;
		background: var(--color-accent-blue, #3b82f6);
		color: #fff;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.strip-menu-save:hover {
		background: #2563eb;
	}

	.strip-menu-delete {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-primary, #212529);
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.strip-menu-delete:hover {
		background: var(--color-surface-hover, #e9ecef);
	}
</style>
