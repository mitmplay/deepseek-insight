<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import type { SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';

	/**
	 * PromptManagerEdit - the manager edit dialog extracted from PromptManagerPanel
	 * (extraction seam, The Prompt Tags ADR D8). Form over the manager; the source
	 * row stays highlighted until Save/Cancel (OCI user spec 2026-08-14). The pair
	 * rides a portal wrapper to document.body when `portal` is true - fixed layers
	 * must escape the floor zoom transform (BC-7); the modal host renders it in
	 * place (its tree is already body-portaled by Composer), so the wrapper is
	 * inert there.
	 */
	let {
		row,
		uses = $bindable('1'),
		macro = $bindable(false),
		label = $bindable(''),
		text = $bindable(''),
		tags = $bindable(''),
		portal = false,
		onsave,
		oncancel
	}: {
		/** The row being edited (its id rides on save). */
		row: SuggestedPrompt;
		uses: string;
		macro: boolean;
		label: string;
		text: string;
		/** Raw tag input (space/comma separated) — the server normalizes. */
		tags: string;
		/** True = portal the pair to document.body (embedded panel host). */
		portal?: boolean;
		onsave: () => void;
		oncancel: () => void;
	} = $props();

	/** Portal the edit pair to document.body (the ImageLightbox/Loupe
	 *  donor pattern, BC-7): position:fixed inside the floor's scaled
	 *  canvas is trapped by the transform; under body it centers on the
	 *  viewport unscaled. Inert (param false) for the modal host. */
	function portalEditPair(node: HTMLElement, enabled: boolean) {
		if (!enabled) return {};
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}
</script>

<div use:portalEditPair={portal} class="mgr-edit-portal">
	<div class="mgr-edit-backdrop" onclick={oncancel} role="presentation"></div>
	<div class="mgr-edit-dialog" role="dialog" aria-label={t(m.editPrompt)}>
	<h3>{t(m.editPrompt)}</h3>
	<div class="mgr-field mgr-field-pair">
		<label class="mgr-field">
			<span>{t(m.uses)}</span>
			<input type="number" class="mgr-edit-uses" bind:value={uses} min="1" />
		</label>
		<label class="mgr-field mgr-field-macro">
			<span>{t(m.macro)}</span>
			<input type="checkbox" class="mgr-edit-macro" bind:checked={macro} />
		</label>
	</div>
	<label class="mgr-field">
		<span>{t(m.label)}</span>
		<input type="text" class="mgr-edit-label" bind:value={label} placeholder={t(m.labelOptional)} />
	</label>
	<label class="mgr-field">
		<span>{t(m.text)}</span>
		<textarea
			class="mgr-edit-text"
			bind:value={text}
			rows={Math.min(10, Math.max(3, text.split('\n').length))}
		></textarea>
	</label>
	<label class="mgr-field">
		<span>{t(m.tags)}</span>
		<textarea class="mgr-edit-tags" bind:value={tags} rows={2}></textarea>
	</label>
	<div class="mgr-edit-actions">
		<button type="button" class="mgr-btn mgr-btn-save" onclick={onsave}>{t(m.save)}</button>
		<button type="button" class="mgr-btn mgr-btn-cancel" onclick={oncancel}>{t(m.cancel)}</button>
	</div>
</div>
</div>

<style>
	/* Portal wrapper: generates no box - the fixed backdrop/dialog pair
	   positions against the viewport in BOTH hosts. */
	.mgr-edit-portal {
		display: contents;
	}
	.mgr-btn {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		cursor: pointer;
		background: var(--color-surface, #f8f9fa);
	}
	.mgr-btn:hover {
		background: var(--color-surface-alt, #f1f3f5);
	}
	.mgr-btn-save {
		color: #16a34a;
	}
	.mgr-btn-cancel {
		color: var(--color-text-muted, #888);
	}
	.mgr-edit-backdrop {
		position: fixed;
		inset: 0;
		z-index: 10005;
		background: rgba(0, 0, 0, 0.35);
	}
	.mgr-edit-dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 10006;
		width: min(90vw, 34rem);
		background: var(--color-surface-elevated, #fff);
		border: 1px solid rgba(139, 92, 246, 0.3);
		border-radius: 0.5rem;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	.mgr-edit-dialog h3 {
		margin: 0 0 0.25rem 0;
		font-size: 0.9375rem;
	}
	.mgr-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.75rem;
	}
	.mgr-field > span {
		font-weight: 600;
		font-size: 0.6875rem;
		text-transform: uppercase;
		color: var(--color-text-muted, #888);
	}
	.mgr-field-pair {
		flex-direction: row;
		gap: 1rem;
		align-items: flex-start;
	}
	.mgr-field-macro {
		gap: 0.375rem;
	}
	.mgr-edit-macro {
		width: 1rem;
		height: 1rem;
		margin-top: 0.125rem;
	}
	.mgr-edit-uses {
		width: 6rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		font-size: 0.75rem;
		background: var(--color-surface, #f8f9fa);
	}
	.mgr-edit-label,
	.mgr-edit-text,
	.mgr-edit-tags {
		padding: 0.25rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		font-size: 0.75rem;
		font-family: inherit;
		background: var(--color-surface, #f8f9fa);
	}
	.mgr-edit-text {
		resize: vertical;
		min-height: 5rem;
	}
	.mgr-edit-tags {
		resize: vertical;
		height: 3.25rem; /* two lines of 0.75rem text */
	}
	.mgr-edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.375rem;
		margin-top: 0.25rem;
	}
</style>