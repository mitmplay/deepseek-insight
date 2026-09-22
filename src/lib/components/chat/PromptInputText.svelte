<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import ClearIconButton from '$lib/components/common/buttons/ClearIconButton.svelte';
	/**
	 * PromptInputText — the composer's textarea (extracted from
	 * PromptInput 2026-09-04). Pure wiring, no logic: every handler
	 * reports upward and the two bindables carry the state back — the
	 * owner keeps everything.
	 *
	 * Bindables (the contract the owner leans on):
	 *  - `el` — the live element, bound back so the owner's focus,
	 *    autosize (scrollHeight vs MAX_ROWS × lineHeight), selection
	 *    reads and draft flushes keep working through the component
	 *    boundary untouched.
	 *  - `value` — the draft text, two-way.
	 *
	 * Geometry: display:block (2026-08-24 alignment fix — a textarea is
	 * INLINE-level: it sits on the text baseline and the line box leaves
	 * ~6px of descender space below it, making the wrapper taller than
	 * the box; items-end then aligned the button to the WRAPPER's bottom
	 * → button 6px below the textarea. display:block collapses the
	 * wrapper onto the box — measured 0px offset, browser-probed).
	 * rows=2 at rest; the OWNER measures and sets height from
	 * `data-max-rows` (it owns MAX_ROWS and isOverflow — the child only
	 * mirrors the overflow class).
	 *
	 * Clear disc (2026-09-22): a ClearIconButton at the bottom-right
	 * while the draft is non-empty and the box is unlocked — it empties
	 * the draft, re-focuses the box, and re-fires `oninput` so the
	 * owner's autosize + draft flush run (the same contract the prompt
	 * manager search uses). The wrapper is position:relative for it;
	 * display:block keeps the wrapper collapsed onto the box.
	 */
	let {
		el = $bindable(undefined),
		value = $bindable(''),
		maxRows,
		isStreaming,
		locked,
		awaiting,
		isOverflow,
		placeholder,
		onkeydown,
		onpaste,
		oninput,
		onfocus,
		onblur,
		oncompositionstart,
		oncompositionend
	}: {
		/** The live element, bound back to the owner. */
		el?: HTMLTextAreaElement;
		/** The draft text, two-way. */
		value?: string;
		/** Row cap for the data attribute — the owner measures against it. */
		maxRows: number;
		isStreaming: boolean;
		/** Submit/stream lock — disables the box. */
		locked: boolean;
		/** In-flight submit awaiting its receipt — drives the pr-8 room. */
		awaiting: boolean;
		/** Owner-measured overflow — picks the scroll class. */
		isOverflow: boolean;
		/** Box copy — a second surface (the sidebar broadcast box) speaks
		 *  its own grammar; absent keeps the panel composer's copy. */
		placeholder?: string;
		onkeydown: (event: KeyboardEvent) => void;
		onpaste: (event: ClipboardEvent) => void;
		oninput: () => void;
		onfocus: () => void;
		onblur: () => void;
		oncompositionstart: () => void;
		oncompositionend: () => void;
	} = $props();

	function clear() {
		value = '';
		oninput(); // owner autosize + draft flush run on the emptied draft
		// re-focus lives in ClearIconButton via the target prop
	}
</script>

<div class="relative block">
	<textarea
		bind:this={el}
		bind:value
		rows="2"
		data-max-rows={maxRows}
		placeholder={isStreaming
			? t(m.promptStreamingPh)
			: (placeholder ?? t(m.promptDefaultPh))}
		disabled={locked}
		onkeydown={onkeydown}
		onpaste={onpaste}
		oninput={oninput}
		onfocus={onfocus}
		onblur={onblur}
		oncompositionstart={oncompositionstart}
		oncompositionend={oncompositionend}
		data-testid="prompt-textarea"
		class="block min-h-[2.75rem] w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 {isOverflow ? 'overflow-y-auto' : 'overflow-y-hidden'} {isStreaming || awaiting ? 'pr-7' : value.length > 0 && !locked ? 'pr-4' : ''}"
	></textarea>
	{#if value.length > 0 && !locked}
		<ClearIconButton onclick={clear} label={t(m.promptClearDraft)} target={el} />
	{/if}
</div>
