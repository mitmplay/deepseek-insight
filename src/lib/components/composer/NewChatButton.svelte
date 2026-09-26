<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * NewChatButton — one-click session create (2026-08-24 revision).
	 *
	 * The agent/workspace pills in SessionFilterRow ARE the selection: this
	 * button creates the session directly from them — no picker dialog.
	 * The agent dimension must be armed: an unselected agent is
	 * answered with an inline alert ("You cannot chat unless you select an
	 * Agent (+ Workspace)") and nothing is created. The component never
	 * imports a server module (BC-2) and never touches the host.
	 *
	 * A rejected create (e.g. unknown preset → 502) shows inline and
	 * unlocks — the user stays put, free to retry.
	 *
	 * Dual-purpose button (2026-08-31 rework): with `onreplace` provided
	 * (the sidebar footer), ONE button serves both verbs. A small
	 * SessionFilterToggle-style segmented toggle at its right picks the verb —
	 * Add (default) or Replace — and the button's label follows the mode.
	 * Null `onreplace` (the home page) renders the plain create button
	 * with no toggle, exactly the pre-floor shape. Both verbs share one
	 * create routine, the `creating` lock, and the alert/error surface;
	 * the mode only chooses the dispatch.
	 *
	 * The selection alert carries its own × dismiss (2026-09-04): closing
	 * it only hides the message — the next unarmed click re-raises it.
	 */

	import { X } from '@lucide/svelte';

	let {
		/** Called with the fresh sessionId after a successful create. */
		oncreated,
		/** Called with the fresh sessionId when the Replace verb runs;
		 *  absent = the mode toggle does not render. */
		onreplace = null,
		/** Selected agent preset id (SessionFilterRow pill) — required. */
		agent = null,
		/** Selected workspace cwd (SessionFilterRow pill) — optional; when
		 *  null the host serves the session from its own default directory. */
		workspace = null,
		/** Compact variant — full-width ghost button for tight containers
		 *  (the sidebar footer); default is the home-page solid button. */
		compact = false,
		/** The missing-selection alert state — bindable so a host (the
		 *  sidebar footer) can render the alert itself, spanning its row. */
		alert = $bindable(false),
		/** Render the alert inline (home-page shape). Set false when the
		 *  host renders the alert externally from the bound state. */
		alertInline = true
	}: {
		oncreated: (sessionId: string, agentPreset: string | null) => void;
		onreplace?: ((sessionId: string, agentPreset: string | null) => void) | null;
		agent?: string | null;
		workspace?: string | null;
		compact?: boolean;
		alert?: boolean;
		alertInline?: boolean;
	} = $props();

	let creating = $state(false);
	let errorMessage = $state<string | null>(null);
	/** (alert state is the bindable prop above.) */
	/** Verb mode (2026-08-31): false = Add (default, never persisted),
	 *  true = Replace. Session-local by design — every load starts Add. */
	let replaceMode = $state(false);

	/**
	 * Create the session from the armed pills, then dispatch to the
	 * armed verb's callback. Guards and error state are shared; the
	 * dispatch is resolved at click time.
	 */
	async function create(dispatch: (sessionId: string, agentPreset: string | null) => void): Promise<void> {
		alert = false;
		// Workspace is OPTIONAL (2026-09-14): the DSH host defaults a missing
		// cwd to its own project directory (session-controller commands.ts:
		// cwd = workspace?.path ?? request.cwd ?? defaultCwd), so an unselected
		// workspace pill no longer blocks the create — only the agent does.
		if (!agent) {
			alert = true;
			return;
		}
		if (creating) return;
		creating = true;
		errorMessage = null;
		try {
			const res = await fetch('/api/dsh/sessions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(workspace ? { agentPreset: agent, cwd: workspace } : { agentPreset: agent })
			});
			const body = (await res.json()) as {
				ok: boolean;
				sessionId?: string;
				agentPreset?: string | null;
				error?: { code: string; message: string };
			};
			if (!res.ok || !body.ok || !body.sessionId) {
				errorMessage = body.error?.message ?? `create failed (${res.status})`;
				return;
			}
			dispatch(body.sessionId, body.agentPreset ?? null);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : String(err);
		} finally {
			creating = false;
		}
	}
</script>

<div class="flex w-full flex-col items-start">
	{#if alert && alertInline}
		<p
			data-testid="new-chat-selection-alert"
			class="mb-1 flex w-full items-center justify-between gap-2 text-xs text-amber-600"
			role="alert"
		>
			<span>{t(m.needAgent)}</span>
			<!-- × dismiss — the PanelHeader close grammar (lucide X, aria-hidden,
			     labeled button); hides the message without touching the pills. -->
			<button
				type="button"
				class="shrink-0 rounded p-0.5 leading-none text-amber-700 hover:bg-amber-100 hover:text-amber-900"
				data-testid="new-chat-selection-alert-close"
				aria-label={t(m.dismissAlert)}
				title={t(m.dismiss)}
				onclick={() => (alert = false)}
			>
				<X size={11} aria-hidden="true" />
			</button>
		</p>
	{/if}
	{#if errorMessage}
		<p data-testid="new-chat-error" class="mb-1 text-xs text-red-600" role="alert">{errorMessage}</p>
	{/if}
	<div class={compact ? 'flex w-full items-stretch gap-2' : 'inline-flex items-stretch gap-2'}>
		<button
			type="button"
			data-testid="new-chat-button"
			class={compact ? 'new-chat min-w-0 flex-1 px-3 py-1.5 text-xs font-medium' : 'new-chat px-3 py-1.5 text-sm font-medium'}
			disabled={creating}
			onclick={() => void create(replaceMode && onreplace !== null ? onreplace : oncreated)}
		>
			{creating ? t(m.creating) : replaceMode && onreplace !== null ? t(m.replaceChat) : t(m.newChat)}
		</button>
		{#if onreplace !== null}
			<!-- Verb toggle — the SessionFilterToggle segmented grammar (joined
			     pill, zero gap, outer curves only, yellowgreen selected). -->
			<div class="seg-group" role="group" aria-label={t(m.chatButtonMode)} data-testid="chat-mode-toggle">
				<button
					type="button"
					class="seg left"
					class:on={!replaceMode}
					disabled={creating}
					aria-pressed={!replaceMode}
					title={t(m.addNextChatAsPanel)}
					data-testid="chat-mode-add"
					onclick={() => (replaceMode = false)}
				>
					{t(m.add)}
				</button>
				<button
					type="button"
					class="seg right"
					class:on={replaceMode}
					disabled={creating}
					aria-pressed={replaceMode}
					title={t(m.replaceFocusedPanel)}
					data-testid="chat-mode-replace"
					onclick={() => (replaceMode = true)}
				>
					{t(m.replace)}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	/* The create button's pastel-blue identity (2026-09-05): the app's
	   blue accent as a pastel field — 15% blue on white — with the
	   navy-deepened text/border grammar the filter chips use. Contrast
	   5.1:1 at rest (AA for normal text); hover deepens field and text
	   together, never below 4.5:1. */
	.new-chat {
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		border-radius: 0.375rem;
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 15%, #fff);
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease;
	}

	.new-chat:not(:disabled):hover {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 22%, #fff);
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 65%, #1e3a8a);
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 55%, #1e3a8a);
	}

	.new-chat:disabled {
		cursor: default;
		opacity: 0.6;
	}

	/* Segmented verb toggle — the SessionFilterToggle.svelte contract copied
	   verbatim (self-contained styles there; scoped rules here): ONE
	   joined pill, zero gap, shared 1px edges (the right segment drops
	   its left border), outer curves only. Rest text #52606d, hover
	   accent-deep, selected yellowgreen with dark text — the app's one
	   segmented-toggle language. */
	.seg-group {
		display: flex;
		align-items: stretch;
		flex-shrink: 0;
	}

	.seg {
		display: inline-flex;
		align-items: center;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, #fff);
		background: transparent;
		color: #52606d;
		font-size: 0.6rem;
		line-height: 1;
		padding: 0.15rem 0.35rem;
		cursor: pointer;
		white-space: nowrap;
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease;
	}

	.seg:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.seg.left {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		border-top-left-radius: 9999px;
		border-bottom-left-radius: 9999px;
	}

	.seg.right {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
		border-top-right-radius: 9999px;
		border-bottom-right-radius: 9999px;
		border-left-width: 0;
	}

	.seg:not(:disabled):hover {
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, #1e3a8a);
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 12%, #fff);
	}

	/* Selected segment — the SessionFilterToggle .on contract: yellowgreen
	   field, dark text (#212529 = 8.19:1; white on yellowgreen is ~2:1). */
	.seg.on {
		background: yellowgreen;
		border-color: color-mix(in srgb, yellowgreen 65%, black);
		color: var(--color-text-primary, #212529);
	}

	.seg.on:not(:disabled):hover {
		background: color-mix(in srgb, yellowgreen 85%, black);
		border-color: color-mix(in srgb, yellowgreen 55%, black);
		color: var(--color-text-primary, #212529);
	}
</style>
