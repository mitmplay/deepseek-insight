/**
 * session-stats — the stats bar's pure derive (ADR 2026-09-08 "The Stats
 * Bar", D2/D3): fold the panel's DsiEntry stream into the per-session
 * numbers the bar renders. No I/O, no Svelte, no store — the panel calls
 * it $derived over store.entries and hands the result down as a prop.
 *
 * Honesty rule (D3): a field is present only when its inputs reached DSI.
 * TTFT, tok/s, and LLM-only wall time have no wire input and are never
 * approximated. toolMs sums only computed result durations (result.time −
 * call.time at merge, dsh-events) — never wall-clock gap filling.
 */

import type { DsiEntry, DsiLedgerStats } from '$lib/types';

/** The stats bar's render input. Optional fields are omitted, not zeroed,
 * when the session's entries carry no such accounting (D3 segment omission). */
export interface SessionStats {
	/** Normal user bubbles — injected runtime-context chips are not turns. */
	turns: number;
	/** Assistant messages — one step each. */
	steps: number;
	/** Sum of computed tool result durations (ms); 0 when no tool ran. */
	toolMs: number;
	/** Sums across assistant messages carrying usage. Undefined when no
	 * message reported accounting at all. inputTokens is UNCACHED input
	 * only (types.ts DsiTokenUsage); cached input rides the cache fields. */
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	/** cacheRead share of total input (uncached + cached read + cache
	 * write), percent rounded to an integer. Present only when a nonzero
	 * total input exists. Pinned by the 1.1-T fixture. */
	cacheHitPercent?: number;
	// ── 'full-ledger' extension (statsFromLedger): whole-log fields the
	// partial fold cannot compute. The bar renders them only when present;
	// a partial stats object stays byte-identical to the ADR baseline. ──
	/** Summed model wall time over message-assembling steps (ms). */
	llmMs?: number;
	/** Summed first-token latency (ms) over ttftSteps. */
	ttftMs?: number;
	/** Steps carrying a recorded first token. */
	ttftSteps?: number;
	/** Summed decode wall time over usage-reporting steps (ms). */
	decodeMs?: number;
	/** Summed output tokens over the same decode-timed steps. */
	decodeTokens?: number;
	/** ALL billed input (uncached + cache read + cache write) across the
	 *  whole log — the 'full-ledger' Input figure (the partial fold's
	 *  inputTokens is uncached-only over seen entries). */
	billedInputTokens?: number;
}

/**
 * Map the host's whole-log ledger stats (statsBar 'full-ledger') onto the
 * bar's render input — the same totals the DSH web stats bar shows
 * (packages/session/session-stats + token-meter projections). The billed
 * input and cache-hit denominator mirror StatsLine.billedInputTokens.
 * @param ledger - the validated DsiLedgerStats pair.
 */
export function statsFromLedger(ledger: DsiLedgerStats): SessionStats {
	const billed = ledger.uncachedInputTokens + ledger.cacheReadTokens + ledger.cacheWriteTokens;
	return {
		turns: ledger.turns,
		steps: ledger.steps,
		toolMs: ledger.toolMs,
		llmMs: ledger.llmMs,
		ttftMs: ledger.ttftMs,
		ttftSteps: ledger.ttftSteps,
		decodeMs: ledger.decodeMs,
		decodeTokens: ledger.decodeTokens,
		inputTokens: ledger.uncachedInputTokens,
		outputTokens: ledger.outputTokens,
		cacheReadTokens: ledger.cacheReadTokens,
		cacheWriteTokens: ledger.cacheWriteTokens,
		billedInputTokens: billed,
		...(billed > 0 ? { cacheHitPercent: Math.round((ledger.cacheReadTokens / billed) * 100) } : {})
	};
}

/**
 * Derive the stats bar's numbers from the transcript entries.
 * @param entries - the panel's projected DsiEntry stream (order-free).
 * @returns null while the session has no assistant message (D5: the bar
 *   renders nothing on an empty or brand-new session).
 */
export function deriveSessionStats(entries: readonly DsiEntry[]): SessionStats | null {
	let turns = 0;
	let steps = 0;
	let toolMs = 0;
	let sawUsage = false;
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	for (const e of entries) {
		if (e.kind === 'user-message') {
			if (e.meta === undefined) turns += 1;
		} else if (e.kind === 'assistant-message') {
			steps += 1;
			if (e.usage !== undefined) {
				sawUsage = true;
				inputTokens += e.usage.inputTokens;
				outputTokens += e.usage.outputTokens;
				cacheReadTokens += e.usage.cacheReadTokens ?? 0;
				cacheWriteTokens += e.usage.cacheWriteTokens ?? 0;
			}
		} else if (e.kind === 'tool-result' && typeof e.durationMs === 'number') {
			toolMs += e.durationMs;
		}
	}
	if (steps === 0) return null;
	const totalInput = inputTokens + cacheReadTokens + cacheWriteTokens;
	return {
		turns,
		steps,
		toolMs,
		...(sawUsage ? { inputTokens, outputTokens } : {}),
		...(sawUsage && cacheReadTokens > 0 ? { cacheReadTokens } : {}),
		...(sawUsage && cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
		...(sawUsage && totalInput > 0 ? { cacheHitPercent: Math.round((cacheReadTokens / totalInput) * 100) } : {})
	};
}
