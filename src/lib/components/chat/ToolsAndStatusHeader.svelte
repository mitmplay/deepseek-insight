<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * ToolsAndStatusHeader — the conversation header's RIGHT cluster
	 * (extracted from ConversationHeader, 2026-08-24): the agent preset
	 * chip, the plan-mode pill (PlanModeChip, extracted 2026-09-01),
	 * the running/idle status pill, and the conversation capture
	 * button (2026-08-25, OCI StickyHeader parity). Purely presentational
	 * — everything arrives as props; nothing reports upward.
	 *
	 * Agent chip copy prefix (2026-08-26): when the raw preset id is
	 * known, a copy-id icon button precedes the label (PanelHeader
	 * precedent) — the click copies the id, 2s ✓ feedback. The chip
	 * tooltip carries the id because the label may be the host's display
	 * name (DSH picker parity: `cordis` reads `Creator mode`).
	 *
	 * data-testids preserved verbatim (agent-chip · running-status ·
	 * canvas-copy-button, plus the prefix agent-chip-copy-id) — page/panel
	 * tests and e2e pin them.
	 */
	import { Check, Copy } from '@lucide/svelte';
	import CanvasCopyButton from '$lib/components/common/buttons/CanvasCopyButton.svelte';
	import ForkButton from '$lib/components/chat/ForkButton.svelte';
	import OpenParentButton from '$lib/components/chat/OpenParentButton.svelte';
	import PlanModeChip from '$lib/components/chat/PlanModeChip.svelte';
	import { copyWithFeedback } from '$lib/utils/clipboard';
	import type { DsiPlanProjection } from '$lib/services/conversation/plan-projection';

	let {
		agent,
		agentId = null,
		isStreaming,
		transcript = null,
		plan = null,
		sessionId,
		title = null,
		parentSessionId = null,
		subagent = false
	}: {
		/** Agent chip label — the host's display name for the preset when it
		 *  carries one, else the raw id (resolved by the floor owner; null =
		 *  chip hidden). DSH picker parity: `cordis` reads `Creator mode`. */
		agent: string | null;
		/** Raw preset id (wire identity) — the copy prefix's value and the
		 *  chip tooltip; null renders a label-only chip. */
		agentId?: string | null;
		/** True while a turn is streaming — the status pill's running state. */
		isStreaming: boolean;
		/** The transcript viewport (canvas capture target, OCI parity);
		 *  null/undefined hides the capture button (no transcript yet). */
		transcript?: HTMLElement | null;
		/** The host's plan-mode projection — the pill renders while plan
		 *  mode is ACTIVE; the pending flag marks an unconfirmed /plan
		 *  switch (null = not delivered → hidden). */
		plan?: DsiPlanProjection | null;
		/** The session id — the fork button's cut source (ADR 2026-09-01). */
		sessionId: string;
		/** Live title — the fork child's best-effort " (fork)" rename seed. */
		title?: string | null;
		/** The fork source's session id (the spine row's parentSessionId) —
		 *  the parent button's jump target; null renders no button. */
		parentSessionId?: string | null;
		/** Sub-agent panels hide the fork button (read-only transcript). */
		subagent?: boolean;
	} = $props();

	/** Copy-agent-id feedback (2s ✓, copyWithFeedback contract). */
	let idCopied = $state(false);
</script>

<div class="ml-auto flex items-center gap-1">
	<!-- Jump back to the fork source (2026-09-01): leads the cluster —
	     before the agent chip — and parks gray+disabled while the parent
	     already holds a panel. Hidden on roots (no parent, no jump). -->
	<OpenParentButton {parentSessionId} />
	{#if agent}
		<span
			class="agent-chip"
			data-testid="agent-chip"
			title={agentId ? `agent preset — ${agentId}` : undefined}
		>
			{#if agentId}
				<button
					type="button"
					class="shrink-0"
					data-testid="agent-chip-copy-id"
					aria-label={t(m.copyAgentPresetId)}
					title={agentId}
					onclick={() => void copyWithFeedback(agentId, (v) => (idCopied = v))}
				>
					{#if idCopied}
						<!-- ✓ keeps its feedback green: state, not identity. -->
						<Check size={10} class="text-green-500" aria-hidden="true" />
					{:else}
						<!-- The Copy inherits the chip color (the filter chip's kind
					     grammar: icon = dimension color, here the agent purple). -->
						<Copy size={10} aria-hidden="true" />
					{/if}
				</button>
			{/if}
			{agent}
		</span>
	{/if}
	<!-- Plan-mode pill (extracted 2026-09-01): renders while plan mode
	     is ACTIVE; PlanModeChip hides itself otherwise. -->
	<PlanModeChip {plan} />
	<span
		class="inline-flex items-center gap-1 text-xs text-slate-500"
		role="status"
		aria-label={isStreaming ? 'running' : 'idle'}
		data-testid="running-status"
	>
		<span
			class="inline-block h-2 w-2 rounded-full"
			class:bg-emerald-500={isStreaming}
			class:bg-slate-300={!isStreaming}
		></span>
		{isStreaming ? 'running' : 'idle'}
	</span>
	<!-- Session fork (The Fork Button ADR, 2026-09-01): branch a new
	     session from the last completed turn; the child joins the floor
	     beside the focus. Hidden on sub-agent panels. -->
	<ForkButton {sessionId} {title} agentPreset={agentId} {subagent} />
	<!-- Conversation capture (2026-08-25, OCI StickyHeader parity): copy
	     the WHOLE conversation as a PNG image — click copies to clipboard,
	     Shift+Click saves as file. The button renders only once the
	     transcript viewport is bound. -->
	{#if transcript}
		<CanvasCopyButton
			container={transcript}
			title={t(m.copyConversationImage)}
			size={12}
			class="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
		/>
	{/if}
</div>

<style>
	/* The filter-summary-chip-agent identity (SessionFilterHeader
	   .chip.agent): border + 8% tint field + purple-deepened text at AA
	   5.25:1 — sized to the header's chip (text-xs, roomier padding), so
	   the agent dimension reads as one identity across sidebar and
	   header. */
	.agent-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid color-mix(in srgb, var(--color-accent-purple, #8b5cf6) 50%, #4c1d95);
		border-radius: 9999px;
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		line-height: 1;
		white-space: nowrap;
		color: color-mix(in srgb, var(--color-accent-purple, #8b5cf6) 50%, #4c1d95);
		background: color-mix(in srgb, var(--color-accent-purple, #8b5cf6) 8%, transparent);
	}
</style>
