/**
 * dsh-events/content — wire-shape content helpers moved whole from
 * dsh-events.ts (ADR-0022 W1): bubble ids, message-content text/image
 * extraction, tool-call summaries, token-usage + read-view normalization.
 * Pure functions, no I/O, no Svelte. Signatures unchanged; formerly-private
 * helpers are exported for the sibling mapper/merge modules.
 */

import type { DsiCodeDispatch, DsiEntry, DsiImageRef } from '$lib/types';
import { truncate } from '$lib/utils/truncate';

/** Raw DSH session event as both the mux (session/event) and the ledger
 * (session.history `event` member) deliver it. Structural, not imported from
 * the server layer: this module is shared by browser and server code (BC-2). */
export interface DshRawEvent {
	type: string;
	seq: number;
	time: number;
	data?: Record<string, unknown>;
	/** Optional presentation view riding next to ledger entries. */
	view?: unknown;
}

/** Stable bubble id for one assistant step (chunk merge key). */
export function bubbleId(turn: unknown, step: unknown): string {
	return `a:${String(turn)}:${String(step)}`;
}

/** Extract validated image refs from a message content array (Wave 3 task
 *  3.1). Wire shape: {type:'image', attachment:{attachmentId, mediaType,
 *  bytes, width, height, name?}} (ImageBlock). Structural validation at the
 *  wire boundary; malformed attachments are skipped, never guessed into
 *  shape. Returns undefined when none survive (lean payloads, text-only
 *  entries unchanged). */
export function imageRefsOfContent(content: unknown): DsiImageRef[] | undefined {
	if (!Array.isArray(content)) return undefined;
	const refs: DsiImageRef[] = [];
	for (const part of content) {
		if (!part || typeof part !== 'object' || (part as { type?: unknown }).type !== 'image') continue;
		const attachment = (part as { attachment?: unknown }).attachment;
		if (!attachment || typeof attachment !== 'object') continue;
		const ref = attachment as Record<string, unknown>;
		if (
			typeof ref.attachmentId !== 'string' ||
			typeof ref.mediaType !== 'string' ||
			typeof ref.bytes !== 'number' ||
			typeof ref.width !== 'number' ||
			typeof ref.height !== 'number'
		) {
			continue;
		}
		refs.push({
			attachmentId: ref.attachmentId,
			mediaType: ref.mediaType,
			bytes: ref.bytes,
			width: ref.width,
			height: ref.height,
			...(typeof ref.name === 'string' ? { name: ref.name } : {})
		});
	}
	return refs.length > 0 ? refs : undefined;
}

/** Join the text parts of a message content array; non-text blocks ignored. */
export function textOfContent(content: unknown): string {
	if (!Array.isArray(content)) return '';
	const parts: string[] = [];
	for (const part of content) {
		if (
			part &&
			typeof part === 'object' &&
			(part as { type?: unknown }).type === 'text' &&
			typeof (part as { text?: unknown }).text === 'string'
		) {
			parts.push((part as { text: string }).text);
		}
	}
	return parts.join('\n');
}

/** tool/call display summary: harness view title when present, else the raw
 * args truncated through the shared util (task 2.1 promotion — single
 * truncation implementation; marker-less head, the chip owns affordances). */
export function callSummary(event: DshRawEvent, argumentsRaw: string): string | undefined {
	const view = event.view as { view?: { title?: unknown } } | undefined;
	const title = view?.view?.title;
	if (typeof title === 'string' && title.length > 0) return title;
	const { head, truncated } = truncate(argumentsRaw, 120);
	if (head.length > 0) return truncated ? `${head}…` : head;
	return undefined;
}

/** Read a wire TokenUsage (assistant/message.data.usage) into its DSI
 * shape — structural and conservative: a non-numeric inputTokens declines
 * to undefined (the event carries no accounting). 2026-08-23. Route
 * attribution rides message.source when both parts are non-empty
 * (2026-09-09, DSH turn-usage parity). */
export function usageOf(
	v: unknown,
	source?: { provider?: unknown; model?: unknown }
): import('$lib/types').DsiTokenUsage | undefined {
	const u = v as Record<string, unknown> | undefined;
	if (u === undefined || typeof u.inputTokens !== 'number' || typeof u.outputTokens !== 'number') {
		return undefined;
	}
	const opt = (n: unknown): number | undefined => (typeof n === 'number' ? n : undefined);
	// The exact total is a count, never zero or fractional (The Exact Total,
	// ADR-0012 D1): copy the host-validated figure, decline junk.
	const count = (n: unknown): number | undefined =>
		(typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : undefined);
	const provider = typeof source?.provider === 'string' && source.provider.length > 0 ? source.provider : undefined;
	const model = typeof source?.model === 'string' && source.model.length > 0 ? source.model : undefined;
	return {
		inputTokens: u.inputTokens,
		outputTokens: u.outputTokens,
		...(count(u.totalTokens) !== undefined ? { totalTokens: count(u.totalTokens) } : {}),
		...(opt(u.cacheReadTokens) !== undefined ? { cacheReadTokens: opt(u.cacheReadTokens) } : {}),
		...(opt(u.cacheWriteTokens) !== undefined ? { cacheWriteTokens: opt(u.cacheWriteTokens) } : {}),
		...(opt(u.reasoningTokens) !== undefined ? { reasoningTokens: opt(u.reasoningTokens) } : {}),
		...(provider !== undefined && model !== undefined ? { provider, model } : {})
	};
}

export function readStr(v: unknown): string | undefined {
	return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function firstOfType(content: unknown, type: string): unknown {
	if (!Array.isArray(content)) return undefined;
	return content.find((p) => (p as { type?: unknown } | undefined)?.type === type);
}

/** Normalize a read-result presentation view (tool/result view.card ===
 * 'read') into DsiReadView. Structural and conservative: any malformed
 * member declines to undefined (the flat resultText path stays). BC-11:
 * the shape is read from the harness's own projection, never re-derived
 * by guessing at arguments. 2026-08-22. */
export function readViewFrom(view: unknown): import('$lib/types').DsiReadView | undefined {
	const v = (view as { view?: Record<string, unknown> } | undefined)?.view;
	if (v === undefined || v.card !== 'read') return undefined;
	const path = readStr(v.path);
	if (path === undefined) return undefined;
	const offset = v.offset;
	const totalLines = v.totalLines;
	const lines = v.lines;
	if (typeof offset !== 'number' || typeof totalLines !== 'number' || !Array.isArray(lines)) return undefined;
	const out: import('$lib/types').DsiReadLine[] = [];
	for (const l of lines) {
		const line = l as { number?: unknown; text?: unknown };
		if (typeof line?.number !== 'number' || typeof line?.text !== 'string') return undefined;
		out.push({ number: line.number, text: line.text });
	}
	const lang = readStr(v.lang);
	return { path, offset, totalLines, lines: out, ...lang !== undefined ? { lang } : {} };
}
