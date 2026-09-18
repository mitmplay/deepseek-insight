/**
 * Wave 1 (task 1.1-T): the PTC sub-dispatch fold (ADR D1/D2, 2026-09-05).
 * Event shapes pinned from session 7ec16d54's ledger — 3 run_code calls,
 * 6 dispatch pairs (5 read, 1 bash). Pins: fold order by subCallId, start →
 * settle fill, settle-after-start and start-after-settle merge, orphan drop,
 * and cold-load (eventsToEntries) vs merge (mergeEntries) parity.
 */
import { describe, expect, it } from 'vitest';
import { entryForEvent, eventsToEntries, mergeEntries, type DshRawEvent } from '$lib/services/conversation/dsh-events';
import type { DsiEntry } from '$lib/types';

const CALL = 'call_0d506ed078c04ccbac0151df';

function ev(seq: number, type: string, data: Record<string, unknown> | undefined, time = seq * 100): DshRawEvent {
	return { seq, time, type, data };
}

function runCodeCall(seq: number, callId = CALL): DshRawEvent {
	return ev(seq, 'tool/call', {
		callId,
		name: 'run_code',
		arguments: JSON.stringify({ code: 'const r = await tools.read({ file_path: "/x/a.md" });', description: 'Read files' })
	});
}

function readStart(seq: number, n: number, path: string, callId = CALL): DshRawEvent {
	return ev(seq, 'tool/ptc-dispatch-start', {
		rootCallId: callId, parentCallId: callId, subCallId: `${callId}:ptc:${n}`, name: 'read',
		arguments: { file_path: path, limit: 60 }
	});
}

function readSettled(seq: number, n: number, path: string, callId = CALL, isError = false): DshRawEvent {
	return ev(seq, 'tool/ptc-dispatch', {
		rootCallId: callId, parentCallId: callId, subCallId: `${callId}:ptc:${n}`, name: 'read',
		arguments: { file_path: path, limit: 60 }, isError,
		content: [{ type: 'text', text: `<path>${path}</path>\n<type>file</type>\n<content>\n1: # Title\n2: body` }]
	});
}

function bashSettled(seq: number, n: number, callId = CALL): DshRawEvent {
	return ev(seq, 'tool/ptc-dispatch', {
		rootCallId: callId, parentCallId: callId, subCallId: `${callId}:ptc:${n}`, name: 'bash',
		arguments: { command: 'ls /x', description: 'List folder' }, isError: false,
		content: [{ type: 'text', text: 'a.md\nb.md' }]
	});
}

function callsOf(entries: DsiEntry[]): Array<Extract<DsiEntry, { kind: 'tool-call' }>> {
	return entries.filter((e): e is Extract<DsiEntry, { kind: 'tool-call' }> => e.kind === 'tool-call');
}

describe('dispatch fold (cold load, eventsToEntries)', () => {
	it('folds all six dispatches onto the run_code call, subCallId-ordered', () => {
		const entries = eventsToEntries([
			runCodeCall(26),
			bashSettled(27, 1),
			readStart(34, 2, '/x/AGENTS.md'),
			readSettled(35, 2, '/x/AGENTS.md')
		]);
		const calls = callsOf(entries);
		expect(calls).toHaveLength(1);
		const d = calls[0]!.dispatches;
		expect(d?.map((x) => x.name)).toEqual(['bash', 'read']);
		expect(d?.[1]!.subCallId).toBe(`${CALL}:ptc:2`);
		expect(d?.[1]!.contentText).toContain('1: # Title');
		expect(entries.some((e) => e.kind === "code-dispatch")).toBe(false);
	});

	it('keeps an unsettled start as a settled:false placeholder', () => {
		const entries = eventsToEntries([runCodeCall(26), readStart(34, 1, '/x/a.md')]);
		const d = callsOf(entries)[0]!.dispatches;
		expect(d).toHaveLength(1);
		expect(d![0]!.settled).toBe(false);
		expect(d![0]!.contentText).toBeUndefined();
		expect(d![0]!.argsRaw).toBe(JSON.stringify({ file_path: '/x/a.md', limit: 60 }));
	});

	it('marks a failed sub-call isError with content kept', () => {
		const entries = eventsToEntries([
			runCodeCall(26),
			readStart(34, 1, '/x/missing.md'),
			readSettled(35, 1, '/x/missing.md', CALL, true)
		]);
		const d = callsOf(entries)[0]!.dispatches![0]!;
		expect(d.settled).toBe(true);
		expect(d.isError).toBe(true);
		expect(d.contentText).toContain('1: # Title');
	});

	it('drops an orphan dispatch (no parent tool-call) — never guesses', () => {
		const entries = eventsToEntries([readStart(34, 1, '/x/a.md')]);
		expect(entries).toHaveLength(0);
	});
});

describe('dispatch fold (live merge, mergeEntries)', () => {
	it('settle-after-start fills the placeholder without un-settling later', () => {
		const cold = eventsToEntries([runCodeCall(26), readStart(34, 1, '/x/a.md')]);
		const delta = [entryForEvent(readSettled(35, 1, '/x/a.md'))]!.filter((e): e is DsiEntry => e !== null);
		const merged = mergeEntries(cold, delta);
		const d = callsOf(merged)[0]!.dispatches![0]!;
		expect(d.settled).toBe(true);
		expect(d.contentText).toContain('1: # Title');
		// Idempotent: a retransmitted start after the settle keeps the facts.
		const again = mergeEntries(merged, [entryForEvent(readStart(99, 1, '/x/a.md'))]!.filter((e): e is DsiEntry => e !== null));
		expect(callsOf(again)[0]!.dispatches![0]!.settled).toBe(true);
	});

	it('merges new partials with dispatches a previous merge already folded', () => {
		const cold = eventsToEntries([runCodeCall(26), readSettled(35, 1, '/x/a.md')]);
		const delta = [
			entryForEvent(readStart(50, 2, '/x/b.md')),
			entryForEvent(readSettled(51, 2, '/x/b.md'))
		].filter((e): e is DsiEntry => e !== null);
		const merged = mergeEntries(cold, delta);
		const d = callsOf(merged)[0]!.dispatches!;
		expect(d.map((x) => x.subCallId)).toEqual([`${CALL}:ptc:1`, `${CALL}:ptc:2`]);
		expect(d[1]!.settled).toBe(true);
	});

	it('start-without-settle stays pending across merges (live honesty)', () => {
		const cold = eventsToEntries([runCodeCall(26), readSettled(35, 1, '/x/a.md')]);
		const delta = [entryForEvent(readStart(50, 2, '/x/b.md'))]!.filter((e): e is DsiEntry => e !== null);
		const merged = mergeEntries(cold, delta);
		const d = callsOf(merged)[0]!.dispatches!;
		expect(d[1]!.settled).toBe(false);
		expect(merged.some((e) => e.kind === 'code-dispatch')).toBe(false);
	});

	it('orders legacy `:code:` subCallIds from migrated V2 logs (0.1.5 rename kept payloads)', () => {
		const legacy = (seq: number, n: number): DshRawEvent =>
			ev(seq, 'tool/ptc-dispatch', {
				rootCallId: CALL, parentCallId: CALL, subCallId: `${CALL}:code:${n}`, name: 'read',
				arguments: { file_path: `/x/${n}.md` }, isError: false,
				content: [{ type: 'text', text: `body ${n}` }]
			});
		const entries = eventsToEntries([runCodeCall(26), bashSettled(27, 1), legacy(35, 2)]);
		const d = callsOf(entries)[0]!.dispatches!;
		expect(d.map((x) => x.subCallId)).toEqual([`${CALL}:ptc:1`, `${CALL}:code:2`]);
	});

	it('cold load and incremental merge agree (parity)', () => {
		const events = [
			runCodeCall(26),
			bashSettled(27, 1),
			readStart(34, 2, '/x/AGENTS.md'),
			readSettled(35, 2, '/x/AGENTS.md'),
			readStart(36, 3, '/x/README.md'),
			readSettled(37, 3, '/x/README.md')
		];
		const cold = eventsToEntries(events);
		let live: DsiEntry[] = [];
		for (const e of events) {
			const mapped = entryForEvent(e);
			live = mergeEntries(live, mapped !== null ? [mapped] : []);
		}
		expect(callsOf(live)[0]!.dispatches).toEqual(callsOf(cold)[0]!.dispatches);
	});
});
