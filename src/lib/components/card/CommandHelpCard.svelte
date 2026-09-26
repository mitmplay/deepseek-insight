<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * CommandHelpCard — the floating help popup above the composer textarea
	 * (command-help, 2026-08-30): renders one line's usage, parameters, and
	 * examples while the draft asks for help with `?` as its entire first
	 * argument. Both feeders produce the same view shape (HelpCardView):
	 * DSI gestures (`/new ?`, `/permission ?`, `@<session-id> ?` — the
	 * COMMAND_HELP copy) and host vocabulary (`/plan ?`, `/dsh-doc ?` —
	 * the catalog row's own description/hint/whenToUse, nothing invented).
	 *
	 * Presentational: the view in, nothing out — Composer owns the
	 * detection (command-help.ts), the Esc dismiss, and the Enter guard.
	 *
	 * Floating geometry (SuggestStrip parity): absolute above the textarea
	 * wrapper (bottom: 100%) — never joins layout, so the textarea's box
	 * never moves when the card appears. Mutually exclusive with the
	 * Suggest Strip by construction (the finder triggers on a leading
	 * `?`/`!`, the help intent on a leading `/` or an `@token ?` tail).
	 */
	import type { HelpCardView } from '$lib/services/chat/command-help';

	let { view }: { view: HelpCardView } = $props();
</script>

<div class="command-help" role="note" aria-label={t(m.commandHelp)} data-testid="command-help">
	<div class="help-usage">
		<code>{view.usage}</code>
		<span class="help-tag">{view.tag}</span>
	</div>
	<p class="help-summary">{view.summary}</p>
	{#if view.params.length > 0}
		<dl class="help-params">
			{#each view.params as p (p.name)}
				<dt><code>{p.name}</code></dt>
				<dd>{p.description}</dd>
			{/each}
		</dl>
	{/if}
	{#if view.examples.length > 0}
		<ul class="help-examples">
			{#each view.examples as ex (ex.line)}
				<li><code>{ex.line}</code><span>{ex.description}</span></li>
			{/each}
		</ul>
	{/if}
	{#if view.note !== undefined}
		<p class="help-note">{view.note}</p>
	{/if}
	<p class="help-hint">{t(m.escHidesA)} <code>?</code> {t(m.escHidesB)}</p>
</div>

<style>
	.command-help {
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		z-index: 5;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.5rem 0.625rem;
		background: var(--color-surface-elevated, #ffffff);
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.5rem 0.5rem 0 0;
		box-shadow: 0 -6px 16px rgba(0, 0, 0, 0.12);
		font-size: 0.75rem;
		color: var(--color-text-secondary, #6c757d);
	}
	.help-usage {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.help-usage code {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-primary, #212529);
	}
	.help-tag {
		padding: 0 0.375rem;
		border-radius: 9999px;
		background: var(--color-accent-blue, #3b82f6);
		color: #ffffff;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
	}
	.help-summary {
		margin: 0;
		line-height: 1.35;
	}
	.help-params {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.help-params dt {
		float: left;
		margin-right: 0.5rem;
	}
	.help-params dt code {
		color: var(--color-accent-purple, #8b5cf6);
	}
	.help-params dd {
		margin: 0;
		line-height: 1.35;
		overflow: hidden;
	}
	.help-examples {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.help-examples li {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		line-height: 1.35;
	}
	.help-examples code {
		color: var(--color-accent-blue, #3b82f6);
		white-space: nowrap;
	}
	.help-note {
		margin: 0;
		line-height: 1.35;
		color: var(--color-text-secondary, #6c757d);
	}
	.help-hint {
		margin: 0;
		color: var(--color-text-muted, #adb5bd);
	}
</style>
