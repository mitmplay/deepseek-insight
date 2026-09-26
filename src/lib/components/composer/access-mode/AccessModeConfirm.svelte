<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';

	/**
	 * AccessModeConfirm — the R7 Full access risk gate (extracted from
	 * AccessModeChip, 2026-09). Presentational: it owns only the local
	 * acknowledgement checkbox — reset by construction, since the gate
	 * unmounts when the parent closes it (state never survives a declined
	 * risk). Preset submission stays the chip's business (onpick), so
	 * this component never touches the wire.
	 *
	 * Portaled to document.body by its own mount effect (BC-7 — the floor's
	 * transform makes an inline fixed mask resolve against the panel-row
	 * box, so the mask here must live outside it). Focusing the mask
	 * gives Escape a target — its own keydown closes the gate.
	 *
	 * Mask click closes only when the click lands on the backdrop itself
	 * (target === currentTarget) — the panel needs no stopPropagation.
	 * The card anchors to the measured focused-panel center (pos),
	 * clamped into the viewport by the measurer; the viewport center is
	 * the fallback when no anchor exists.
	 */
	let {
		disabled = false,
		pos = null,
		oncancel,
		onconfirm
	}: {
		/** Mirrors the chip's submit lock — Enable stays disabled while the
		 *  panel's submit is in flight. */
		disabled?: boolean;
		/** Measured anchor (the focused panel's center, viewport-clamped);
		 *  null falls back to the viewport center. */
		pos?: { x: number; y: number } | null;
		/** Cancel / Escape / mask click — submit nothing, close the gate. */
		oncancel: () => void;
		/** Enable (requires the acknowledgement); the parent closes the
		 *  gate and submits the preset. */
		onconfirm: () => void | Promise<void>;
	} = $props();

	/** The acknowledgement — the checkbox gates the Enable button. */
	let acknowledged = $state(false);

	/** The dialog root — portaled to document.body by the effect below. */
	let confirmEl = $state<HTMLElement | undefined>(undefined);

	// Portal to document.body (BC-7 — the zoom escape; same grammar as
	// StripChip). Focusing the mask gives Escape a target — its own
	// keydown closes the gate.
	$effect(() => {
		if (!confirmEl) return;
		const el = confirmEl; // capture: bind:this nulls confirmEl before cleanup runs
		document.body.appendChild(el);
		el.focus();
		return () => {
			el.remove();
		};
	});

	function onModalKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') oncancel();
	}
</script>

<div
	bind:this={confirmEl}
	class="fixed inset-0 z-50 bg-black/40"
	data-testid="access-mode-confirm"
	role="dialog"
	aria-modal="true"
	aria-label={t(m.enableFullAccessQ)}
	tabindex="-1"
	onkeydown={onModalKeydown}
	onclick={(e) => {
		if (e.target === e.currentTarget) oncancel();
	}}
>
	<div
		class="absolute w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-4 shadow-xl"
		style={pos ? 'left:' + pos.x + 'px; top:' + pos.y + 'px;' : 'left:50%; top:50%;'}
	>
		<h2 class="text-sm font-semibold text-slate-800">{t(m.enableFullAccessQ)}</h2>
		<p class="mt-2 text-xs leading-relaxed text-slate-600">
			{t(m.fullAccessWarning)}
		</p>
		<label class="mt-3 flex items-start gap-2 text-xs text-slate-700">
			<input
				type="checkbox"
				bind:checked={acknowledged}
				data-testid="access-mode-acknowledge"
				class="mt-0.5"
			/>
			<span>{t(m.iUnderstandFullAccess)}</span>
		</label>
		<div class="mt-4 flex justify-end gap-2">
			<button
				type="button"
				class="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
				data-testid="access-mode-cancel"
				onclick={oncancel}
			>
				{t(m.cancel)}
			</button>
			<button
				type="button"
				class="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
				disabled={!acknowledged || disabled}
				data-testid="access-mode-enable"
				onclick={() => void onconfirm()}
			>
				{t(m.enableFullAccess)}
			</button>
		</div>
	</div>
</div>
