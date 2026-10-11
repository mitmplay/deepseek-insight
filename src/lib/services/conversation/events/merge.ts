/**
 * dsh-events/merge — the merge machinery moved whole from dsh-events.ts
 * (ADR-0022 W4): delta merge, tool-result pairing, code-dispatch fold,
 * system-prompt collapse, workflow-run fold. Pure functions; doc comments
 * ride verbatim below.
 */

import type { DsiCodeDispatch, DsiEntry } from '$lib/types';

/**
 * Merge incoming DsiEntry deltas into an existing list (id-keyed, idempotent):
 *
 *   assistant-message, same id, finalized — REPLACES (the assembled message
 *       is authoritative over any streamed prefix, text AND reasoning; this
 *       is how the durable assistant/message finalizes the live-tail bubble
 *       folded by the store's applyLiveStream);
 *   any other kind, known id — ignored (retransmit);
 *   unknown id — appended.
 *
 *   (Ledger v2 removed the durable chunk events whose fragments CONCAT'ed
 *   here while streaming; the live tail carries the full accumulation each
 *   poll and replaces wholesale in the store, outside this merge.)
 *
 * Tool lifecycle (Wave 1, task 1.2): tool/call is born status:'pending';
 * a paired tool/result flips it to pass/fail (result.ok, i.e. isError on the
 * wire) and carries durationMs = result.time − call.time — both directions of
 * arrival (cold load has call+result together; polls may deliver result into
 * a list that already holds the call). An orphan result (no call in the list)
 * keeps its honest state: name unknown → 'tool', duration undefined.
 *
 * Also pairs tool-result entries with their tool-call by callId (fills
 * toolName). Server cold load and client poll deltas share these rules.
 */
export function mergeEntries(existing: DsiEntry[], incoming: DsiEntry[]): DsiEntry[] {
	const merged: DsiEntry[] = existing.map((e) => ({ ...e }));
	for (const entry of incoming) {
		const at = merged.findIndex((e) => e.id === entry.id);
		if (at === -1) {
			merged.push({ ...entry });
			continue;
		}
		const candidate = merged[at]!;
		if (candidate.kind === 'workflow-run' && entry.kind === 'workflow-run') {
			merged[at] = mergeWorkflowRun(candidate, entry);
			continue;
		}
		// code-dispatch partials share one id per sub-call (`cd:<subCallId>`);
		// unlike content-stable kinds, a settle ADDS facts — merge, never drop
		// (the fold below then attaches the merged partial).
		if (candidate.kind === 'code-dispatch' && entry.kind === 'code-dispatch') {
			if (entry.argsRaw !== undefined) candidate.argsRaw = entry.argsRaw;
			candidate.time = entry.time > candidate.time ? entry.time : candidate.time;
			if (entry.settled) {
				candidate.settled = true;
				candidate.isError = entry.isError;
				candidate.contentText = entry.contentText;
			}
			continue;
		}
		const prev = candidate as Extract<DsiEntry, { kind: 'assistant-message' }>;
		if (prev.kind === 'assistant-message' && entry.kind === 'assistant-message') {
			if (!entry.streaming) {
				// Finalize wins — but only where the final message actually CARRIES
				// the content: a finalize with no reasoning block does not erase
				// streamed reasoning (the wire never contradicted it), and a
				// finalize with no text keeps the streamed text.
				const next: Extract<DsiEntry, { kind: 'assistant-message' }> = { ...entry };
				if (next.reasoning === undefined && prev.reasoning !== undefined) {
					next.reasoning = prev.reasoning;
					next.reasoningStreaming = false; // the step finished
				}
				if (next.text === '') next.text = prev.text;
				merged[at] = next;
			}
			// A streaming entry can no longer arrive through this merge (the
			// live tail replaces in the store) — same id, streaming → ignore.
			continue;
		}
		// Edited-Files pointer (ADR 2026-09-25, D3): a same-turn
		// re-announce REPLACES — the newer event is the summary's live
		// pointer and the older one is stale by the Host's own latest-wins
		// contract; two cards for one turn would render a multiplicity the
		// producer retired.
		if (candidate.kind === 'files-edited' && entry.kind === 'files-edited') {
			if (entry.seq > candidate.seq) merged[at] = { ...entry };
			continue;
		}
		// same id, non-assistant kinds are content-stable — ignore retransmits
	}

	// Pair tool results with their calls (callId → toolName), both directions of
	// arrival, then resolve lifecycle: status flip + durationMs from wire times.
	const calls = new Map<string, Extract<DsiEntry, { kind: 'tool-call' }>>();
	for (const e of merged) {
		if (e.kind === 'tool-call') calls.set(e.callId, e);
	}
	for (const e of merged) {
		if (e.kind !== 'tool-result') continue;
		const call = calls.get(e.callId);
		if (call) {
			// 'tool' is the orphan fallback — still "unknown", so a late-arriving
			// call (result-before-call poll order) re-pairs it with the real name.
			if (!e.toolName || e.toolName === '' || e.toolName === 'tool') e.toolName = call.toolName;
			if (!e.durationMs && e.time >= call.time) e.durationMs = e.time - call.time;
		}
		if (!e.toolName || e.toolName === '') e.toolName = 'tool';
		if (call && call.status === 'pending') call.status = e.ok ? 'pass' : 'fail';
	}

	foldCodeDispatches(merged);
	return merged;
}

/**
 * Fold `code-dispatch` partials onto their parent tool-call entries
 * (ADR D1/D2, 2026-09-05). Start and settled partials merge by subCallId —
 * a settle fills content/isError and never un-settles; a late start after a
 * settle keeps the settle's facts. Entries fold by parentCallId → the call's
 * `dispatches` list in `<n>` submission order. Orphans (no parent call in
 * the list) are dropped — the fold never guesses a parent. Idempotent:
 * retransmitted partials rewrite the same facts; the folded entry carries
 * fresh arrays, so re-running never aliases a prior list.
 */
function foldCodeDispatches(entries: DsiEntry[]): void {
	const bySub = new Map<string, Extract<DsiEntry, { kind: 'code-dispatch' }>>();
	for (const e of entries) {
		if (e.kind !== 'code-dispatch') continue;
		const prev = bySub.get(e.subCallId);
		if (prev === undefined) {
			bySub.set(e.subCallId, e);
			continue;
		}
		// Settle wins where it carried facts; identity fields match by id.
		prev.time = e.time > prev.time ? e.time : prev.time;
		if (e.argsRaw !== undefined) prev.argsRaw = e.argsRaw;
		if (e.settled) {
			prev.settled = true;
			prev.isError = e.isError;
			prev.contentText = e.contentText;
		}
	}
	if (bySub.size === 0) return;

	const calls = new Map<string, Extract<DsiEntry, { kind: 'tool-call' }>>();
	for (const e of entries) {
		if (e.kind === 'tool-call') calls.set(e.callId, e);
	}

	// Group by parent, then attach subCallId-ordered (trailing <n> of
	// `<callId>:code:<n>`; non-numeric tails sort last, stably).
	const grouped = new Map<string, Extract<DsiEntry, { kind: 'code-dispatch' }>[]>();
	for (const d of bySub.values()) {
		const list = grouped.get(d.parentCallId) ?? [];
		list.push(d);
		grouped.set(d.parentCallId, list);
	}
	const orderOf = (subCallId: string): number => {
		// 0.1.5-alpha.1 mints `:ptc:<n>`; the type-rename migration preserves old
		// payloads, so migrated V2 logs still carry `:code:<n>`.
		const m = /:(?:code|ptc):(\d+)$/.exec(subCallId);
		return m !== null ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
	};
	for (const [parentCallId, list] of grouped) {
		list.sort((a, b) => orderOf(a.subCallId) - orderOf(b.subCallId));
		const call = calls.get(parentCallId);
		if (call === undefined) continue; // orphan — dropped below, never guessed
		// Merge with dispatches a PREVIOUS merge already folded onto this
		// call (existing entries carry them; new partials supplement). The
		// SETTLED side owns isError/contentText — a stale retransmitted
		// start never un-settles a kept settle, and a settle outranks a
		// kept placeholder.
		const kept = new Map(call.dispatches?.map((d) => [d.subCallId, d]) ?? []);
		const next: DsiCodeDispatch[] = [];
		const seen = new Set<string>();
		for (const d of list) {
			seen.add(d.subCallId);
			const k = kept.get(d.subCallId);
			const winner = d.settled ? d : (k?.settled ? k : d);
			next.push({
				subCallId: d.subCallId,
				name: d.name,
				...(winner.argsRaw !== undefined ? { argsRaw: winner.argsRaw } : k?.argsRaw !== undefined ? { argsRaw: k.argsRaw } : {}),
				settled: d.settled || (k?.settled ?? false),
				...(winner.isError !== undefined ? { isError: winner.isError } : {}),
				...(winner.contentText !== undefined ? { contentText: winner.contentText } : {})
			});
		}
		for (const d of kept.values()) {
			if (!seen.has(d.subCallId)) next.push({ ...d });
		}
		next.sort((a, b) => orderOf(a.subCallId) - orderOf(b.subCallId));
		call.dispatches = next;
	}

	// Folded artifacts leave the render list; orphans leave with them.
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i]!.kind === 'code-dispatch') entries.splice(i, 1);
	}
}

/**
 * Collapse repeated `system-prompt` entries to one row per DISTINCT text
 * (2026-09-01): a request/header is appended per epoch — initial, resume,
 * change, series — so an uncollapsed transcript would repeat the identical
 * "System prompt" row after every host restart or tools-only header bump.
 * DSH's own Chat decides per header (`showsPrompt`); DSI cannot, because
 * scroll-up pages map through fresh calls with no earlier-page state — so
 * the rule is textual and stateless: keep a system-prompt row only when its
 * text differs from the last KEPT one. Pure, order-preserving, idempotent;
 * safe to re-run at every merge point (mapped batches, client deltas,
 * prepended older pages).
 */
export function collapseSystemPromptEntries(entries: DsiEntry[]): DsiEntry[] {
	let lastKept: string | undefined;
	const out: DsiEntry[] = [];
	for (const e of entries) {
		if (e.kind === 'system-prompt') {
			if (e.text === lastKept) continue;
			lastKept = e.text;
		}
		out.push(e);
	}
	return out;
}

/**
 * Fold ONE workflow-run partial into the running entry (2026-08-31).
 * Partials carry only what their event proved — run-start owns the name,
 * agent-start appends a member, agent-end settles a member by its member
 * seq (label/childId are NEVER overwritten by a settle partial's empty
 * strings), run-end sets the terminal status. Idempotent: a retransmitted
 * partial rewrites the same facts; a running status never un-settles a
 * terminal one.
 */
function mergeWorkflowRun(
	prev: Extract<DsiEntry, { kind: 'workflow-run' }>,
	incoming: Extract<DsiEntry, { kind: 'workflow-run' }>
): Extract<DsiEntry, { kind: 'workflow-run' }> {
	const agents = [...prev.agents];
	for (const a of incoming.agents) {
		const at = agents.findIndex((x) => x.seq === a.seq);
		if (at === -1) {
			agents.push({ ...a });
			continue;
		}
		agents[at] = {
			...agents[at],
			// A settle partial carries empty label/childId — never let one
			// erase identity; conversely a late-arriving start FILLS a stub.
			label: agents[at].label === '' && a.label !== '' ? a.label : agents[at].label,
			childId: agents[at].childId === '' && a.childId !== '' ? a.childId : agents[at].childId,
			startedAt: agents[at].startedAt > 0 ? agents[at].startedAt : a.startedAt,
			status: a.status !== 'running' ? a.status : agents[at].status,
			...(a.phase !== undefined ? { phase: a.phase } : {}),
			...(a.endedAt !== undefined ? { endedAt: a.endedAt } : {})
		};
	}
	return {
		...prev,
		seq: Math.max(prev.seq, incoming.seq),
		time: Math.max(prev.time, incoming.time),
		name: prev.name !== '' ? prev.name : incoming.name,
		status: incoming.status !== 'running' ? incoming.status : prev.status,
		agents
	};
}
