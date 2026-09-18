<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * AddPanel — the tray's paste-add field (Panel Floor W5 task 5.1), now
	 * two verbs over one input:
	 *  - Add   (submit / Enter) → `addPanelFromSidebar`: a NEW panel joins
	 *    beside the focused one.
	 *  - Rplc  (click only)     → `replaceSelectedFromRegistry`: the pasted
	 *    session takes the ACTIVE panel's place — same slot, same width —
	 *    instead of growing the row. Empty floor degrades to a plain add;
	 *    same-session id is a visible no-op; sub-agent lineage placement
	 *    follows the same rules as the sidebar's Shift+click.
	 *
	 * Both fire through the panel registry (the ONLY leaf→root action
	 * channel — the tray is a leaf exactly like a spine row; the route's
	 * registered handlers apply dedupe/placement and persist). Rplc is
	 * `type="button"` so Enter keeps submitting Add — one keystroke can
	 * never surprise with a replacement.
	 *
	 * Input sanitizes before firing: trim whitespace; empty → no-op (the
	 * field keeps focus; the floor never sees a junk action). A successful
	 * fire clears the field — the panel appearing is the feedback.
	 */
	import { addPanelFromSidebar, replaceSelectedFromRegistry } from '$lib/services/panels/panel-registry';

	let value = $state('');

	function submit(): void {
		const id = value.trim();
		if (id.length === 0) return;
		addPanelFromSidebar({ sessionId: id, agentPreset: null });
		value = '';
	}

	function replace(): void {
		const id = value.trim();
		if (id.length === 0) return;
		replaceSelectedFromRegistry({ sessionId: id, agentPreset: null });
		value = '';
	}
</script>

<form
	class="add-panel"
	onsubmit={(e) => {
		e.preventDefault();
		submit();
	}}
>
	<input
		type="text"
		data-testid="controlbar-add-input"
		aria-label={t(m.sessionIdToOpen)}
		placeholder={t(m.pasteSessionId)}
		bind:value
	/>
	<button type="submit" data-testid="controlbar-add-submit" title={t(m.openAsPanel)}>{t(m.add)}</button>
	<button
		type="button"
		data-testid="controlbar-replace-submit"
		title={t(m.replaceActivePanel)}
		onclick={replace}
	>{t(m.rplc)}</button>
</form>

<style>
	.add-panel {
		display: flex;
		gap: 0.375rem;
		align-items: center;
	}

	.add-panel input {
		flex: 1;
		min-width: 0;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.375rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		font-family: ui-monospace, monospace;
		color: var(--color-text-primary, #212529);
		background: var(--color-surface-primary, #fff);
	}

	.add-panel input:focus-visible {
		outline: 2px solid var(--color-accent-blue, #3b82f6);
		outline-offset: -1px;
	}

	.add-panel button {
		flex-shrink: 0;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.375rem;
		padding: 0.25rem 0.625rem;
		font-size: 0.75rem;
		background: var(--color-surface-secondary, #f1f3f5);
		color: var(--color-text-primary, #212529);
		cursor: pointer;
	}

	.add-panel button:focus-visible {
		outline: 2px solid var(--color-accent-blue, #3b82f6);
		outline-offset: -1px;
	}
</style>
