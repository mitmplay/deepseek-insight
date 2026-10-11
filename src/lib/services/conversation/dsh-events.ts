/**
 * dsh-events — mux/session events → DsiEntry render list. Pure mapping, no
 * I/O, no Svelte: the same functions run server-side (cold load from the
 * ledger, poll deltas in api-dsh) and client-side (store merge).
 *
 * Wire shapes pinned 2026-08-21 by live probes + harness sources, re-truthed
 * 2026-09-04 for the 0.1.3 ledger (packages/core/session/src/types.ts
 * SessionEventMap, known-event-types.ts):
 *
 *   user/message       data.content: [{type:'text',text}], data.id, data.source
 *   assistant/message  data.turn, data.step, data.message.content blocks
 *                      (final assembled message — finalizes the streaming
 *                       bubble). 0.1.3 ledger v2 embeds the step's exact
 *                       timed model stream beside it (data.stream); the
 *                       chunk events this file used to stream from are
 *                       gone — live text rides the follow's assistant-stream
 *                       tail (dsh-connection → store.applyLiveStream).
 *   tool/call          data.callId, data.name, data.arguments (raw JSON string)
 *   tool/result        data.message.source.callId, data.message.content[0]
 *                      ({type:'tool-result', content:[{type:'text'}], isError})
 *
 * Wave-1 tool truth (PRD §3.4): event.time (ms epoch) is on every entry;
 * tool/call keeps the raw arguments (argsRaw) and is born status:'pending';
 * tool/result carries resultText and gains durationMs at merge — computed as
 * result.time − call.time from the SAME wire events (display metadata, never
 * wall-clock guessing). status flips pending→pass/fail only when the paired
 * result arrives (callId), so an unfinished call stays honestly pending.
 *
 * Everything else is either a known-internal harness marker (silent — see
 * SILENT_TYPES) or an unknown type (forward-compat: rendered as a passthrough
 * chip so nothing the harness records disappears silently).
 *
 * Wave-2 readable rendering: reasoning-delta fragments merge into
 * `reasoning` (concat, finalize-wins — the exact rules text uses, keyed on
 * the same bubble id, but a SEPARATE field so the text path is untouched);
 * the finalized assistant/message's {type:'reasoning'} content block is
 * authoritative and replaces any streamed reasoning prefix. User messages
 * injected by the harness runtime-context plugin are detected by their
 * fixture-pinned source marker and flagged `meta:'runtime-context'` —
 * conservative: anything not matching the pinned marker stays a normal
 * bubble (BC-11: detection traces to wire source fields, never text guessing
 * alone).
 */

import type { DsiEntry } from '$lib/types';
import { type DshRawEvent } from './events/content';
import { type ContextInjectionProducer } from './events/context-injection';
import { entryForEvent } from './events/mapper';
import { collapseSystemPromptEntries, mergeEntries } from './events/merge';

export type { ContextInjectionProducer, DshRawEvent };
export { collapseSystemPromptEntries, entryForEvent, mergeEntries };

/** Full ledger tail → merged render list (cold load; BC-4 reads the ledger). */
export function eventsToEntries(events: DshRawEvent[]): DsiEntry[] {
	const mapped = events.map(entryForEvent).filter((e): e is DsiEntry => e !== null);
	return collapseSystemPromptEntries(mergeEntries([], mapped));
}

/** Ledger HistoryEntry[] → raw events with their presentation views carried
 * (2026-08-22): the harness attaches `view` BESIDE `event` on each history
 * entry — a plain `.map((h) => h.event)` drops it, and the read-result file
 * rendering lost its typed data. Views merge shallowly; the event's own
 * member (if a wire ever carries one) wins. */
export function historyToEvents(history: Array<{ event: DshRawEvent; view?: unknown }>): DshRawEvent[] {
	return history.map((h) =>
		h.view === undefined || h.event.view !== undefined
			? h.event
			: { ...h.event, view: h.view }
	);
}
