<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';

	/**
	 * PromptManagerAdd - the add-prompt dialog extracted from PromptManagerPanel
	 * (extraction seam, The Prompt Tags ADR D8). Same dialog pattern as
	 * PromptManagerEdit: backdrop + centered form, portal pair to document.body
	 * when `portal` is true (BC-7 - fixed layers escape the floor zoom
	 * transform); the modal host renders it in place, so the wrapper is inert
	 * there. The panel owns `addingNew` and the POST.
	 */
	let {
		uses = $bindable('1'),
		macro = $bindable(false),
		text = $bindable(''),
		label = $bindable(''),
		tags = $bindable(''),
		portal = false,
		onsave,
		oncancel
	}: {
		/** Starting use_count (string form, like PromptManagerEdit). */
		uses: string;
		/** Starting macro flag (The Prompt Macro ADR, 2026-08-29). */
		macro: boolean;
		text: string;
		label: string;
		/** Raw tag input (space/comma separated) - the server normalizes. */
		tags: string;
		/** True = portal the pair to document.body (embedded panel host). */
		portal?: boolean;
		onsave: () => void;
		oncancel: () => void;
	} = $props();

	/** Portal the dialog to document.body (the ImageLightbox/Loupe donor
	 *  pattern, BC-7): position:fixed inside the floor's scaled canvas is
	 *  trapped by the transform; under body it centers on the viewport
	 *  unscaled. Inert (param false) for the modal host. */
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
	<div class="mgr-edit-dialog" role="dialog" aria-label={t(m.addPrompt)}>
	<h3>{t(m.addPrompt)}</h3>
	<!-- Field sequence mirrors PromptManagerEdit: uses+macro pair, label,
	     text, tags — one form grammar across the manager's two dialogs. -->
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
		<input type="text" class="mgr-add-label" bind:value={label} placeholder={t(m.labelOptional)} />
	</label>
	<label class="mgr-field">
		<span>{t(m.text)}</span>
		<textarea
			class="mgr-add-text"
			bind:value={text}
			placeholder={t(m.promptTextPh)}
			rows={Math.min(10, Math.max(3, text.split('\n').length))}
		></textarea>
	</label>
	<label class="mgr-field">
		<span>{t(m.tags)}</span>
		<input type="text" class="mgr-add-tags" bind:value={tags} placeholder={t(m.tags)} />
	</label>
	<div class="mgr-edit-actions">
		<button type="button" class="mgr-btn mgr-btn-save" onclick={onsave}>{t(m.addPrompt)}</button>
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
	.mgr-add-text {
		padding: 0.25rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		font-size: 0.75rem;
		font-family: inherit;
		background: var(--color-surface, #f8f9fa);
		resize: vertical;
	}
	.mgr-add-label,
	.mgr-add-tags {
		padding: 0.25rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		font-size: 0.75rem;
		font-family: inherit;
		background: var(--color-surface, #f8f9fa);
	}
	.mgr-edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.375rem;
		margin-top: 0.25rem;
	}
</style>