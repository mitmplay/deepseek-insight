// @vitest-environment node
/**
 * Live wire spike (0.1.2 edition) — DSH_LIVE=1 gated.
 *
 * Proves, against a running dsh web host (127.0.0.1:3080), that DSI's OWN
 * production stack — DshAuth cookie mint, slash endpoints with the
 * descriptor-exact {args} envelope, the ONE /api/remote.mux carrier — clears
 * the real host. Every call rides getDshConnection(); nothing here speaks a
 * hand-rolled envelope:
 *   1. session.list round trip (cookie fence crossed)
 *   2. remote.mux follow baseline: subscribe + waitForProjections lands values
 *   3. session/page tail read for a real session (events + hasMore), then a
 *      beforeSeq page strictly below the head
 *   4. agentPreset.list round trip (picker source of truth)
 *   5. session.create → real sessionId (scratch, /tmp)
 *   6. session.prompt receipt {accepted:true} then session.cancel receipt
 *   7. session.rename round trip {title, seq}, visible in the list row
 *   8. session/modelCatalog + session/selectModel round trip
 *   9. the follow assistantStream opt-in (0.1.3-alpha.1) is accepted; the
 *      live tail read stays null while no attempt is in flight
 *
 * Port history: the pre-0.1.2 spike (dot endpoints, {args}-less envelopes,
 * /api/events.mux framings, /api/respond carrier) died with the 0.1.2 wire —
 * see the KB note "The Alpha Jump" (dev/kb/releases/). The real-turn answerer
 * probes (approval escalation, context-injection markers) rode the old
 * carrier; their live behavior is covered by the dev-server probe and
 * tests/live/error-codes.test.ts pins the $events/result door.
 *
 * Skips cleanly (exit 0) when DSH_LIVE is unset (BC-8: an absent host must
 * never fail CI); fails fast with a clear message when DSH_LIVE=1 but the
 * host is unreachable or the launch token is stale (401 → re-mint → 401).
 */

import { describe, expect, it } from 'vitest';
import { getDshConnection } from '$lib/server/dsh-connection';

const liveGate = process.env.DSH_LIVE === '1';

/** A preset the host ACTUALLY serves — never a hardcoded name (the
 *  2026-09-14 pass: 'main' was retired host-side, agent-preset/not-found). */
const anyPreset = async (): Promise<string> =>
	(await getDshConnection().listPresets()).presets[0]?.id ?? 'standard';

describe.skipIf(!liveGate)('DSH live wire spike (0.1.2)', { timeout: 30_000 }, () => {
	it('1. session.list round-trips through the cookie fence', async () => {
		const list = await getDshConnection().listSessions();
		expect(Array.isArray(list.items)).toBe(true);
	});

	it('2. remote.mux follow baseline lands projection values for a real session', async () => {
		const conn = getDshConnection();
		const { items } = await conn.listSessions();
		const sid = items[0]?.sessionId;
		if (sid === undefined) return; // no sessions on host — nothing to follow
		conn.ensureDownlinks();
		conn.subscribe(sid);
		const block = await conn.waitForProjections(sid);
		// The $events ready frame + session follow baseline arrived: the ONE
		// carrier serves the cold-load seed (+page.server's own dependency).
		expect(block).not.toBeNull();
		expect(typeof block?.values).toBe('object');
	});

	it('3. session/page reads the tail for a real session; beforeSeq pages strictly below', async () => {
		const conn = getDshConnection();
		const { items } = await conn.listSessions();
		const withLedger = items.find((r) => (r.turns ?? 0) > 0);
		const sid = withLedger?.sessionId ?? items[0]?.sessionId;
		if (sid === undefined) return; // no sessions — nothing to read
		const tail = await conn.history(sid);
		expect(Array.isArray(tail.events)).toBe(true);
		expect(typeof tail.hasMore).toBe('boolean');
		const head = tail.events.at(-1)?.event.seq;
		if (head === undefined) return; // empty ledger — paging trivially holds
		const page = await conn.historyPage(sid, head);
		for (const h of page.events) {
			expect(h.event.seq).toBeLessThan(head);
		}
	});

	it('4. agentPreset.list round-trips and lists presets (picker source of truth)', async () => {
		const { presets } = await getDshConnection().listPresets();
		expect(presets.length).toBeGreaterThan(0);
		for (const p of presets) {
			expect(typeof p.id).toBe('string');
		}
	});

	it('5+6. session.create returns a real sessionId; prompt receipt then cancel receipt', async () => {
		const conn = getDshConnection();
		const { sessionId: sid } = await conn.createSession('/tmp', await anyPreset());
		expect(sid.length).toBeGreaterThan(0);
		try {
			const receipt = await conn.prompt(sid, 'DSI wire spike — ignore', 'queue');
			expect(receipt.accepted).toBe(true);
			const cancel = await conn.cancel(sid);
			expect(cancel.accepted).toBe(true);
		} finally {
			await conn.cancel(sid).catch(() => undefined);
		}
	});

	it('7. session.rename round-trips: pins the title, returns {title, seq}', async () => {
		const conn = getDshConnection();
		const { sessionId: sid } = await conn.createSession('/tmp', await anyPreset());
		const stamp = `DSI 0.1.2 spike ${new Date().toISOString().slice(11, 19)}`;
		try {
			const renamed = await conn.renameSession(sid, stamp);
			expect(renamed.title).toBe(stamp); // normalized == verbatim for plain text
			expect(typeof renamed.seq).toBe('number');
		} finally {
			await conn.cancel(sid).catch(() => undefined);
		}
	});

	it('8. modelCatalog + selectModel round trip reports the new selection', async () => {
		const conn = getDshConnection();
		const { sessionId: sid } = await conn.createSession('/tmp', await anyPreset());
		try {
			const before = await conn.listModels(sid);
			expect(typeof before.routable).toBe('boolean');
			expect(Array.isArray(before.groups)).toBe(true);
			let provider = '';
			let model = '';
			for (const g of before.groups) {
				for (const m of g.models) {
					if (before.current && g.id === before.current.provider && m.id === before.current.model) continue;
					provider = g.id;
					model = m.id;
					break;
				}
				if (provider !== '') break;
			}
			if (provider === '') {
				// Single-model catalog already current — the round trip is still
				// proven by re-selecting it verbatim.
				provider = before.current!.provider;
				model = before.current!.model;
			}
			const selected = await conn.selectModel(sid, provider, model);
			expect(selected?.provider).toBe(provider);
			const after = await conn.listModels(sid);
			expect(after.current?.provider).toBe(provider);
			expect(after.current?.model).toBe(model);
		} finally {
			await conn.cancel(sid).catch(() => undefined);
		}
	});

	it('9. the follow assistantStream opt-in is accepted; the live tail read stays null while idle', async () => {
		// 0.1.3-alpha.1: DSI's follow open now carries assistantStream:true —
		// a descriptor-bound spelling nobody typed before this jump. Probe 2
		// proves the snapshot lands WITH the opt-in (a descriptor mismatch
		// would error the stream and strand waitForProjections); this pin
		// adds the read side: the tail exists, is null while no attempt is
		// in flight, and the durable cursor algebra is untouched by frames.
		const conn = getDshConnection();
		const { sessionId: sid } = await conn.createSession('/tmp', await anyPreset());
		try {
			conn.ensureDownlinks();
			conn.subscribe(sid);
			const block = await conn.waitForProjections(sid);
			expect(block).not.toBeNull(); // snapshot accepted → opt-in spelling valid
			expect(conn.liveAssistantStream(sid)).toBeNull();
			expect(conn.eventsSince(sid, 0).lastSeq).toBeGreaterThanOrEqual(-1);
		} finally {
			await conn.cancel(sid).catch(() => undefined);
		}
	});
});