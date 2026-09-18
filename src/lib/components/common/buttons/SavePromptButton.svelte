<script lang="ts">
	/**
	 * SavePromptButton — add a bubble's text to the prompts library
	 * (The Prompt Tags ADR, 2026-09-14, D6): the click OPENS a small
	 * anchored popup — bubble text preview, the operator's vocabulary
	 * chips (settings.yaml prompts.tags via /api/config store), an
	 * optional label, then Save. The state machine behind Save is the
	 * original check-then-POST verbatim: GET /api/prompts?q= exact-text
	 * check → duplicate state on a hit; a miss POSTs { text, label?,
	 * tags } (tags always an array — [] = untagged, additive for stale
	 * callers). A 409 on POST is a lost race — same UX as a hit. States
	 * idle → checking → saved | duplicate | error, inline on the trigger
	 * (icon swap + note as the title tooltip, 2.6 s note). Tagging at
	 * birth is the ONLY birth path a row has (D7 — /use inserts nothing).
	 */
	import { BookmarkPlus, Check, AlertTriangle } from '@lucide/svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { appConfig } from '$lib/services/config/app-config.svelte';

	let {
		text,
		size = 12,
		title = 'Save prompt',
		class: className = ''
	}: {
		/** The bubble's text — the value saved to the library. */
		text: string;
		size?: number;
		title?: string;
		class?: string;
	} = $props();

	/** idle → checking → saved | duplicate | error */
	let saveState = $state<'idle' | 'checking' | 'saved' | 'duplicate' | 'error'>('idle');
	let note = $state('');
	let noteTimer: ReturnType<typeof setTimeout> | null = null;
	/** Popup visibility — ephemeral; the POST is the only hand-off (D6). */
	let open = $state(false);
	let picked = $state<string[]>([]);
	let label = $state('');
	let wrapEl: HTMLElement | undefined = $state();

	const vocabulary = $derived(appConfig().prompts.tags);

	/** Portal the popup to document.body, anchored under the trigger:
	 *  position:absolute inside the message flow is trapped by ancestors'
	 *  stacking contexts and z-orders (live-failed e2e: a sibling bubble's
	 *  paragraph intercepted the Save click) — the Loupe/BC-7 donor pattern:
	 *  fixed layers live under body, outside every flow transform. */
	function portalPopup(node: HTMLElement) {
		document.body.appendChild(node);
		const rect = wrapEl?.getBoundingClientRect();
		if (rect) {
			node.style.top = `${rect.bottom + 6}px`;
			node.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
		}
		return {
			destroy() {
				node.remove();
			}
		};
	}

	function togglePopup(e: MouseEvent): void {
		e.stopPropagation();
		if (saveState === 'checking') return;
		if (!text.trim()) return;
		open = !open;
		if (open) {
			picked = [];
			label = '';
		}
	}

	function toggleChip(word: string): void {
		picked = picked.includes(word) ? picked.filter((w) => w !== word) : [...picked, word];
	}

	/** Flash a note as the button tooltip for 2.6 s, then back to idle. */
	function showNote(msg: string): void {
		note = msg;
		if (noteTimer) clearTimeout(noteTimer);
		noteTimer = setTimeout(() => {
			note = '';
			saveState = 'idle';
		}, 2600);
	}

	async function save(e: MouseEvent): Promise<void> {
		e.stopPropagation();
		if (saveState === 'checking') return;
		const trimmed = text.trim();
		if (!trimmed) return;
		saveState = 'checking';
		try {
			// Exact-text existence check (thin client; server owns matching truth)
			const res = await fetch(`/api/prompts?q=${encodeURIComponent(trimmed)}&limit=1`);
			const data = res.ok ? ((await res.json()) as { results?: { text: string }[] }) : null;
			const exists = !!data?.results?.some((r) => r.text === trimmed);
			if (exists) {
				open = false;
				saveState = 'duplicate';
				showNote('already in the prompt library');
				return;
			}
			const add = await fetch('/api/prompts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: trimmed, ...(label.trim() ? { label: label.trim() } : {}), tags: picked })
			});
			if (add.status === 409) {
				// Lost a race (added between check and POST) — same UX as a hit
				open = false;
				saveState = 'duplicate';
				showNote('already in the prompt library');
				return;
			}
			if (!add.ok) {
				saveState = 'error';
				showNote('save failed');
				return;
			}
			open = false;
			saveState = 'saved';
			showNote('prompt saved');
		} catch {
			open = false;
			saveState = 'error';
			showNote('network error');
		}
	}

	function cancel(e: MouseEvent): void {
		e.stopPropagation();
		open = false;
	}

	$effect(() => {
		return () => {
			if (noteTimer) clearTimeout(noteTimer);
		};
	});
</script>

<span bind:this={wrapEl} class="save-prompt-wrap {className}">
	<button
		type="button"
		class="shrink-0"
		title={note || title}
		aria-label={title}
		aria-expanded={open}
		data-testid="save-prompt-button"
		onclick={togglePopup}
		disabled={!text.trim()}
	>
		{#if saveState === 'saved'}
			<Check {size} class="text-green-500" />
		{:else if saveState === 'duplicate'}
			<AlertTriangle {size} class="text-amber-500" />
		{:else}
			<BookmarkPlus {size} class={saveState === 'checking' ? 'animate-pulse' : ''} />
		{/if}
	</button>
	{#if open}
		<!-- D6: a small anchored popover (NOT the manager's portal dialog —
		     this button lives inside the message flow). -->
		<div class="save-prompt-popup" role="dialog" aria-label={t(m.savePrompt)} data-testid="save-prompt-popup" use:portalPopup>
			<div class="save-prompt-preview">{text}</div>
			{#if vocabulary.length > 0}
				<div class="save-prompt-chips" role="group" aria-label={t(m.tags)}>
					{#each vocabulary as word (word)}
						<button
							type="button"
							class="save-prompt-chip"
							class:on={picked.includes(word)}
							aria-pressed={picked.includes(word)}
							onclick={(e) => { e.stopPropagation(); toggleChip(word); }}
						>{word}</button>
					{/each}
				</div>
			{/if}
			<input
				type="text"
				class="save-prompt-label"
				bind:value={label}
				placeholder={t(m.labelOptional)}
				aria-label={t(m.labelOptional)}
				onclick={(e) => e.stopPropagation()}
			/>
			<div class="save-prompt-actions">
				<button type="button" class="save-prompt-cancel" onclick={cancel}>{t(m.cancel)}</button>
				<button type="button" class="save-prompt-save" data-testid="save-prompt-confirm" onclick={save} disabled={saveState === 'checking'}>
					{t(m.save)}
				</button>
			</div>
		</div>
	{/if}
</span>

<style>
	.save-prompt-wrap {
		position: relative;
		display: inline-flex;
	}
	.save-prompt-popup {
		/* Portaled to body (BC-7): fixed against the viewport — the top/right
		   offsets are set by the portal action from the trigger's rect. z sits
		   above the message flow, below the manager's edit pair (10005). */
		position: fixed;
		z-index: 9000;
		width: 16rem;
		background: var(--color-surface-elevated, #fff);
		border: 1px solid rgba(139, 92, 246, 0.3);
		border-radius: 0.5rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.save-prompt-preview {
		font-size: 0.6875rem;
		color: var(--color-text-secondary, #495057);
		max-height: 4.5rem;
		overflow: hidden;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		border-bottom: 1px solid var(--color-surface-border, #dee2e6);
		padding-bottom: 0.375rem;
	}
	.save-prompt-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.save-prompt-chip {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.625rem;
		background: var(--color-surface, #f8f9fa);
		color: var(--color-text-secondary, #495057);
		font-size: 0.6875rem;
		line-height: 1.25rem;
		padding: 0 0.5rem;
		cursor: pointer;
	}
	.save-prompt-chip.on {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 14%, transparent);
		border-color: var(--color-accent-blue, #3b82f6);
		color: var(--color-accent-blue, #3b82f6);
		font-weight: 600;
	}
	.save-prompt-label {
		width: 100%;
		padding: 0.25rem 0.375rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		font-size: 0.75rem;
		background: var(--color-surface, #f8f9fa);
	}
	.save-prompt-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.375rem;
	}
	.save-prompt-cancel,
	.save-prompt-save {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.25rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		cursor: pointer;
		background: var(--color-surface, #f8f9fa);
	}
	.save-prompt-save {
		color: #16a34a;
	}
	.save-prompt-save:disabled {
		opacity: 0.5;
		cursor: wait;
	}
</style>
