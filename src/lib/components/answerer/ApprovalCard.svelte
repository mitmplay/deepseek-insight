<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/** 
	 * ApprovalCard — one pending tool-approval request from the harness
	 * (POC-3 W2, task 2.1; ADR-0004: when the harness asks, the page answers).
	 *
	 * Presentational — props only, no fetches (Module Map: store → components
	 * via props). The wire body is rendered VERBATIM (BC-D): toolName and
	 * reason exactly as the host stated them, nothing pre-selected, and no
	 * "always allow" anywhere (the wire has no such grant — the UI must not
	 * fake one).
	 *
	 * State machine (driven by `state` + `outcome` props, owned by the store):
	 *   waiting          — buttons live: Allow once / Reject
	 *   in-flight        — own respond POST is on the wire; buttons locked
	 *                      (double-submit guard; the store releases on settle
	 *                      or transport failure)
	 *   settled          — own answer won; outcome names which button won
	 *   answered-elsewhere — the receipt said not-pending: another UI won the
	 *                      first-claimant race (BC-B: graceful, never an error)
	 *   withdrawn        — resolved {outcome:'cancelled'}: the turn died and
	 *                      the card withdraws; cancelled cards never re-ask
	 *
	 * XSS posture: toolName/reason are wire text — rendered as TEXT nodes
	 * only ({...} interpolation), never {@html} (BC-12: the two sanctioned
	 * sinks are markdown-fed; this card has none).
	 */
	interface Props {
		/** Pending answer rpcId (wire-stable correlation for the respond carrier). */
		rpcId: string;
		/** approval/requested body VERBATIM: {approvalId, toolName, callId?, reason?}. */
		toolName: string;
		approvalId: string;
		callId?: string;
		reason?: string;
		phase: 'waiting' | 'in-flight' | 'settled' | 'answered-elsewhere' | 'withdrawn';
		/** Settlement outcome once settled: 'allowed-once' | 'rejected' | string. */
		outcome?: string;
		/** Fired on button click (waiting only); the parent owns the POST. */
		onanswer?: (outcome: 'allowed-once' | 'rejected') => void;
	}

	let { rpcId, toolName, approvalId, callId, reason, phase, outcome, onanswer }: Props = $props();

	const outcomeLabel = $derived.by(() => {
		if (outcome === 'allowed-once') return 'allowed once';
		if (outcome === 'rejected') return 'rejected';
		return outcome ?? '';
	});
</script>

<div
	class="max-w-[85%] self-start rounded-2xl bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-slate-200"
	data-testid="approval-card"
	data-rpc-id={rpcId}
	data-phase={phase}
>
	<div class="flex items-center gap-2">
		<span
			aria-hidden="true"
			class="inline-block h-2 w-2 shrink-0 rounded-full {phase === 'withdrawn'
				? 'bg-slate-400'
				: phase === 'settled' || phase === 'answered-elsewhere'
					? 'bg-emerald-500'
					: 'bg-amber-500'}"
		></span>
		<span class="font-medium" data-testid="approval-tool">{t(m.toolApproval)} {toolName}</span>
	</div>

	{#if reason}
		<p class="mt-1.5 whitespace-pre-wrap break-words text-slate-600" data-testid="approval-reason">{reason}</p>
	{/if}
	{#if callId}
		<p class="mt-1 font-mono text-[11px] text-slate-400" data-testid="approval-call-id">call {callId}</p>
	{/if}

	{#if phase === 'waiting' || phase === 'in-flight'}
		<div class="mt-3 flex items-center gap-2">
			<button
				type="button"
				data-testid="approval-allow"
				disabled={phase === 'in-flight'}
				onclick={() => onanswer?.('allowed-once')}
				class="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{phase === 'in-flight' ? t(m.sending) : t(m.allowOnce)}
			</button>
			<button
				type="button"
				data-testid="approval-reject"
				disabled={phase === 'in-flight'}
				onclick={() => onanswer?.('rejected')}
				class="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{t(m.reject)}
			</button>
			{#if phase === 'in-flight'}
				<span class="text-xs text-slate-400" data-testid="approval-inflight">answering…</span>
			{/if}
		</div>
	{:else if phase === 'settled'}
		<p class="mt-2 text-xs text-emerald-700" data-testid="approval-settled">
			{t(() => m.approvedResolved({ label: outcomeLabel }))}
		</p>
	{:else if phase === 'answered-elsewhere'}
		<p class="mt-2 text-xs text-slate-500" data-testid="approval-elsewhere">
			{t(m.answeredElsewhere)}
		</p>
	{:else if phase === 'withdrawn'}
		<p class="mt-2 text-xs text-slate-500" data-testid="approval-withdrawn">
			{t(m.requestWithdrawn)}
		</p>
	{/if}
</div>
