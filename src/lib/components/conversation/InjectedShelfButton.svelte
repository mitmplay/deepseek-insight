<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { FileText } from '@lucide/svelte';
	import CopyButton from '$lib/components/common/buttons/CopyButton.svelte';
	import FloatingAnchorContainerPopup from '$lib/components/common/containers/FloatingAnchorContainerPopup.svelte';
	import { injectedFullPath, injectedRecordFor, injectedShelfFor } from '$lib/services/conversation/injected-shelf';
	import { executeCommand } from '$lib/services/chat/command-executor';
	import { loadinjectedCommand } from '$lib/services/chat/command-parser';
	import type { DsiEntry } from '$lib/types';

	/**
	 * InjectedShelfButton — the FloatingAnchor's Injected leaf (The
	 * Loadinjected ADR D6): lists the conversation's injected documents in
	 * the operator's order (system-prompt first, then instructions by first
	 * injection) and opens one through the SAME parser→executor path the
	 * composer command takes — placement, lineage, and dedupe have exactly
	 * one implementation. It NEVER calls the floor registry directly (D6's
	 * rejected alternative: a second write path to the floor).
	 *
	 * Hosting lives in FloatingAnchorContainerPopup since 2026-09-08 (The
	 * Popup Shell ADR D1/D2): placement, pointer re-entry, and the close
	 * contract (Escape or a trusted outside click; the trigger exempt) are
	 * the container's — this leaf renders ONLY the rows (copy affordance,
	 * pick, first-load divider). The popup is titled (user decision
	 * 2026-09-08, amending the ADR's D3 default): "Injected files: (n)".
	 *
	 * Renders NOTHING when the shelf is empty — the gate moved in with the
	 * button (the UserMessagesButton shape: self-contained with its popup).
	 */
	let {
		entries,
		sessionId,
		workspace = null,
		panelId = null,
		onnote
	}: {
		/** The conversation's dispatched entries — the shelf derives live. */
		entries: readonly DsiEntry[];
		/** The conversation the documents belong to (the dedupe pair's source half). */
		sessionId: string;
		/** The session workspace cwd — joins a member's relative display path
		 *  into the terminal-reachable FULL path (Loadinjected D6/D7). */
		workspace?: string | null;
		/** The owning floor panel — null outside a floor (the executor's honest no). */
		panelId?: string | null;
		/** Note sink — the executor's honest usage/no-match notes land here. */
		onnote?: (ok: boolean, note: string) => void;
	} = $props();

	/** Popup open state — the active tone mirrors it on the button. */
	let open = $state(false);
	/** The popup's trigger exclusion element (the wrapper div). */
	let triggerEl: HTMLElement | undefined = $state(undefined);

	const members = $derived(injectedShelfFor(entries));

	/** The D6 pick (amended 2026-09-17, The Retired Typed Command ADR
	 *  D3): the SAME executor path, composed through the parser's
	 *  constructor — the typed string is retired grammar the button must
	 *  never re-assemble. */
	function pick(displayPath: string): void {
		open = false;
		const parsed = loadinjectedCommand(displayPath, { add: true });
		void executeCommand(
			parsed,
			{ sessionId, workspace: null, agent: null, panelId, entries },
			onnote
		);
	}
</script>

{#if members.length > 0}
	<div class="relative" bind:this={triggerEl}>
		<button
			type="button"
			class="floating-anchor-btn tone-maroon"
			class:active={open}
			title={t(m.injectedTitle)}
			data-testid="injected-shelf-button"
			onclick={() => (open = !open)}
		>
			<FileText size={14} />
		</button>
		<FloatingAnchorContainerPopup bind:open {triggerEl} title={t(() => m.injectedFiles({ n: members.length }))} titleTestId="injected-shelf-popup-header" popupTestId="injected-shelf-popup">
			{#each members as m, i (m.displayPath)}
				{#if i > 0 && members[i - 1].firstLoad === true && m.firstLoad === false}
					<!-- The FIRST-LOAD boundary: everything above arrived in the
					     session's baseline (system prompt + baseline
					     instructions); everything below was injected LATER as
					     the session touched new scopes. -->
					<hr class="shelf-divider" data-testid="shelf-first-load-divider" />
				{/if}
				<div
					class="shelf-item"
					data-testid="injected-shelf-item"
					data-display-path={m.displayPath}
				>
					<!-- Prefix copy affordance. HONEST per kind (D7): a real
					     file copies the terminal-reachable FULL path (workspace
					     joined); the synthetic system-prompt member is NOT a
					     file — it copies the logged PROMPT TEXT instead, and the
					     tooltip says so. CopyButton stops propagation, so
					     copying never picks. -->
					<CopyButton
						value={m.origin === 'system-prompt'
							? (injectedRecordFor(entries, m.displayPath)?.text ?? m.displayPath)
							: injectedFullPath(workspace, m.displayPath)}
						title={m.origin === 'system-prompt'
							? 'Copy prompt text — a shelf name, not a file'
							: 'Copy full path'}
						class="shelf-copy"
					/>
					<button
						type="button"
						role="menuitem"
						class="shelf-pick"
						data-testid="injected-shelf-pick"
						title={m.displayPath}
						onclick={() => pick(m.displayPath)}
					>
						<!-- The FULL display path is the label, unconditionally: five
						     files can share one basename (five AGENTS.md files is a
						     real desk), and a basename-only list reads as five
						     duplicates — the operator cannot pick the right file. -->
						<span class="shelf-pick-path">{m.displayPath}</span>
					</button>
				</div>
			{/each}
		</FloatingAnchorContainerPopup>
	</div>
{/if}

<style>
	.relative {
		position: relative;
	}

	.floating-anchor-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 9999px;
		cursor: pointer;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		transition: background 0.15s, color 0.15s, transform 0.1s;
		pointer-events: auto;
	}

	.floating-anchor-btn:hover {
		transform: scale(1.08);
	}

	/* Maroon tone — the document-child paint (DOC_CHILD_PAINT #800000, ADR
	   D3): the button and the sidebar rows speak the same vocabulary. */
	.tone-maroon {
		border: 1px solid #800000;
		background: color-mix(in srgb, #800000 12%, transparent);
		color: #800000;
	}

	.tone-maroon:hover {
		color: var(--color-text-primary, #fff);
	}

	.tone-maroon.active {
		background: #800000;
		color: white;
		border-color: #800000;
	}

	.floating-anchor-btn :global(svg) {
		color: inherit;
	}

	.shelf-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.25rem;
		border-radius: 0.25rem;
	}

	.shelf-item:hover {
		background: color-mix(in srgb, #800000 8%, transparent);
	}

	/* The origin boundary (D6/D7): the system-prompt shelf name is a
	   different KIND of member than the injected files — the divider makes
	   the two families legible at a glance. */
	.shelf-divider {
		width: 100%;
		margin: 0.125rem 0;
		border: none;
		border-top: 1px solid var(--color-surface-border, #dee2e6);
	}

	/* The prefix copy affordance — same mini-button grammar as the row
	   buttons: quiet by default, the Copy icon turns into the green Check
	   for 2s after a copy (CopyButton's own feedback). :global — the button
	   element belongs to CopyButton's component scope; the local .shelf-item
	   ancestor anchors the override (the WorkspaceRowItem :global(.label)
	   precedent). */
	.shelf-item :global(.shelf-copy) {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.125rem;
		height: 1.125rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: inherit;
		opacity: 0.6;
		cursor: pointer;
	}

	.shelf-item :global(.shelf-copy:hover) {
		opacity: 1;
		background: var(--color-surface-hover, rgb(0 0 0 / 0.1));
	}

	/* The pick target fills the rest of the row — clicking anywhere on the
	   path opens the document. The FULL display path IS the label
	   (basename-first read as five duplicates on a multi-AGENTS desk).
	   Long paths ellipsize; the full text stays in the button's title. */
	.shelf-pick {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0.25rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
		font-size: 0.75rem;
	}

	.shelf-pick:hover {
		background: color-mix(in srgb, #800000 8%, transparent);
	}

	.shelf-pick-path {
		min-width: 0;
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
</style>
