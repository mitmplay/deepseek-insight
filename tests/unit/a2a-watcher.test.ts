/**
 * a2a-watcher tests (Task 3.1-T) — the watcher's binding contracts:
 * batched single LIST per tick regardless of waiting count; gate
 * closed/open; tiered settles (exact / attributed / approx); timeout;
 * gone; degrade lane (turns null); ticker stop/resume; boot sweep
 * expires stale; ZERO-model-call assertion (spy: no prompt RPC).
 * Node env (environmentMatchGlobs) — node:sqlite externalized (Task 2.1).
 *
 * SPAN capture (2026-08-25 RCA #2, live a2a-30b51db8): reply_text = the
 * JOINED turn span — anchored on the sig-bearing prompt (NOT the late
 * register watermark), bounded by the next delegation's prompt; the
 * end-signature tier contract still rules attribution.
 *
 * Spec: dev/specs/2026-08-25 - DSI a2a Signature and Delegation Ledger
 *      (Tasks 3.1/3.1-T; PRD "Watcher sequence" + tier contract).
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	__resetA2aDbCache,
	A2A_DB_ENV,
	getRow,
	insertWaiting,
	listWaiting,
	type A2aInsertWaiting
} from '$lib/server/a2a/db.js';
import {
	__resetWatcherForTests,
	configureWatcher,
	isTicking,
	registerWatch,
	sweepOnBoot,
	tick,
	watcherStats,
	type WatcherDshSurface,
	type WatcherSpineRow
} from '$lib/server/a2a/watcher.js';

// ── Fixtures ──────────────────────────────────────────────────────────

let tmpRoot: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), 'dsi-a2a-watcher-'));
	process.env[A2A_DB_ENV] = join(tmpRoot, 'a2a.sqlite');
	__resetA2aDbCache();
	__resetWatcherForTests();
});

afterAll(() => {
	delete process.env[A2A_DB_ENV];
	__resetA2aDbCache();
	__resetWatcherForTests();
});

function spineRow(p: Partial<WatcherSpineRow> & { sessionId: string }): WatcherSpineRow {
	return {
		title: 'target',
		running: false,
		updatedAt: 1_000,
		turns: 0,
		...p
	};
}

function waitingRow(
	p: Partial<A2aInsertWaiting> & { id: string; toSession: string }
): A2aInsertWaiting {
	return {
		id: p.id,
		fromSession: p.fromSession ?? 'session-sender',
		toSession: p.toSession,
		message: p.message ?? 'run tests and report',
		watermarkTurn: p.watermarkTurn ?? 0,
		watermarkSeq: p.watermarkSeq ?? null,
		sentAt: p.sentAt ?? Date.now() - 500
	};
}

/** One finalized assistant reply entry in DshHistoryPage shape. */
function historyPage(replyText: string, seq = 40) {
	return {
		events: [
			{
				event: {
					type: 'user/message',
					seq: seq - 1,
					time: 1_000,
					data: { content: [{ type: 'text', text: 'go' }] }
				}
			},
			{
				event: {
					type: 'assistant/message',
					seq,
					time: 2_000,
					data: {
						turn: 1,
						step: 0,
						message: { content: [{ type: 'text', text: replyText }] }
					}
				}
			}
		],
		hasMore: false
	};
}

/** Injectable fake surface with call counters. */
interface FakeDsh extends WatcherDshSurface {
	listCalls: number;
	historyCalls: number;
	prompt: ReturnType<typeof vi.fn>;
}

function fakeDsh(p: {
	items: WatcherSpineRow[];
	historyBySession?: Record<string, ReturnType<typeof historyPage>>;
}): FakeDsh {
	const fake: FakeDsh = {
		listCalls: 0,
		historyCalls: 0,
		prompt: vi.fn(async () => ({ accepted: true })),
		async listSessions() {
			fake.listCalls++;
			return { items: p.items };
		},
		async history(sessionId: string) {
			fake.historyCalls++;
			return p.historyBySession?.[sessionId] ?? historyPage('');
		}
	};
	return fake;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('a2a-watcher — singleton + lanes (Task 3.1-T)', () => {
	it('ONE batched listSessions per tick — 3 waiting targets', async () => {
		const fake = fakeDsh({
			items: [
				spineRow({ sessionId: 'session-a' }),
				spineRow({ sessionId: 'session-b' }),
				spineRow({ sessionId: 'session-c' })
			]
		});
		configureWatcher({ dsh: fake });
		insertWaiting(waitingRow({ id: 'a2a-aaa', toSession: 'session-a' }));
		insertWaiting(waitingRow({ id: 'a2a-bbb', toSession: 'session-b' }));
		insertWaiting(waitingRow({ id: 'a2a-ccc', toSession: 'session-c' }));
		await tick();
		expect(fake.listCalls).toBe(1);
		expect(watcherStats().listCalls).toBe(1);
		// Gate closed everywhere (turns 0 = watermark, not running) — waiting.
		expect(listWaiting().length).toBe(3);
	});

	it('gate open → exact settle (instructed echo ends with _a2a_:id;)', async () => {
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: 1 })],
			historyBySession: { 'session-a': historyPage('All tests pass. _a2a_:a2a-abc;') }
		});
		configureWatcher({ dsh: fake });
		insertWaiting(waitingRow({ id: 'a2a-abc', toSession: 'session-a', watermarkTurn: 0 }));
		await tick();
		const row = getRow('a2a-abc');
		expect(row?.state).toBe('replied_exact');
		expect(row?.replyText).toContain('All tests pass');
	});

	it('gate open, no signature → replied_approx (never a confident claim)', async () => {
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: 1 })],
			historyBySession: { 'session-a': historyPage('Done, 12/12 green.') }
		});
		configureWatcher({ dsh: fake });
		insertWaiting(waitingRow({ id: 'a2a-abc', toSession: 'session-a', watermarkTurn: 0 }));
		await tick();
		const row = getRow('a2a-abc');
		expect(row?.state).toBe('replied_approx');
		expect(row?.replyText).toContain('Done');
	});

	it('tier 2 — _a2a_:id mid-text settles replied', async () => {
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: 1 })],
			historyBySession: {
				'session-a': historyPage('Done. (sig: _a2a_:a2a-abc in middle)')
			}
		});
		configureWatcher({ dsh: fake });
		insertWaiting(waitingRow({ id: 'a2a-abc', toSession: 'session-a', watermarkTurn: 0 }));
		await tick();
		expect(getRow('a2a-abc')?.state).toBe('replied');
	});

	it('timeout settle — deadline wins over a late matching reply', async () => {
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: 1 })],
			historyBySession: { 'session-a': historyPage('late reply _a2a_:a2a-abc;') }
		});
		configureWatcher({ dsh: fake, watchTimeoutMs: 1 });
		insertWaiting(waitingRow({ id: 'a2a-abc', toSession: 'session-a', watermarkTurn: 0 }));
		await tick();
		const row = getRow('a2a-abc');
		expect(row?.state).toBe('timeout');
		expect(row?.error).toContain('no reply within');
		expect(row?.replyText).toBeNull();
	});

	it('gone settle — target absent from spine', async () => {
		const fake = fakeDsh({ items: [] });
		configureWatcher({ dsh: fake });
		insertWaiting(waitingRow({ id: 'a2a-gone', toSession: 'session-x', watermarkTurn: 0 }));
		await tick();
		const row = getRow('a2a-gone');
		expect(row?.state).toBe('gone');
		expect(row?.error).toContain('left the spine');
	});

	it('degrade lane — turns null settles approx + turns_unavailable note', async () => {
		const fake = fakeDsh({
			items: [
				spineRow({ sessionId: 'session-a', turns: null, updatedAt: Date.now() + 10_000 })
			],
			historyBySession: { 'session-a': historyPage('degraded but done') }
		});
		configureWatcher({ dsh: fake });
		insertWaiting(waitingRow({ id: 'a2a-abc', toSession: 'session-a', watermarkTurn: 0 }));
		await tick();
		const row = getRow('a2a-abc');
		expect(row?.state).toBe('replied_approx');
		expect(row?.error).toContain('turns unavailable');
	});

	it('gate closed while running — no history read', async () => {
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: 1, running: true })],
			historyBySession: { 'session-a': historyPage('halfway _a2a_:a2a-abc;') }
		});
		configureWatcher({ dsh: fake });
		insertWaiting(waitingRow({ id: 'a2a-abc', toSession: 'session-a', watermarkTurn: 0 }));
		await tick();
		expect(fake.historyCalls).toBe(0);
		expect(getRow('a2a-abc')?.state).toBe('waiting');
	});

	it('stacked mentions — one history read settles both rows at own tiers', async () => {
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: 2 })],
			historyBySession: {
				'session-a': historyPage('both done. final: _a2a_:a2a-second;')
			}
		});
		configureWatcher({ dsh: fake });
		insertWaiting(waitingRow({ id: 'a2a-first', toSession: 'session-a', watermarkTurn: 0 }));
		insertWaiting(waitingRow({ id: 'a2a-second', toSession: 'session-a', watermarkTurn: 1 }));
		await tick();
		expect(fake.historyCalls).toBe(1);
		// The page text carries only the second signature terminally.
		expect(getRow('a2a-second')?.state).toBe('replied_exact');
		expect(getRow('a2a-first')?.state).toBe('replied_approx');
	});

	it('ticker stop/resume — zero waiting stops; register re-arms', async () => {
		vi.useFakeTimers();
		try {
			const fake = fakeDsh({
				items: [spineRow({ sessionId: 'session-a', turns: 1 })],
				historyBySession: { 'session-a': historyPage('ok _a2a_:a2a-t1;') }
			});
			configureWatcher({ dsh: fake, fastPollMs: 100 });
			registerWatch(waitingRow({ id: 'a2a-t1', toSession: 'session-a', watermarkTurn: 0 }));
			expect(isTicking()).toBe(true);
			await vi.advanceTimersByTimeAsync(150);
			expect(getRow('a2a-t1')?.state).toBe('replied_exact');
			expect(isTicking()).toBe(false);
			registerWatch(waitingRow({ id: 'a2a-t2', toSession: 'session-a', watermarkTurn: 1 }));
			expect(isTicking()).toBe(true);
		} finally {
			__resetWatcherForTests();
			vi.useRealTimers();
		}
	});

	it('boot sweep expires stale waiting rows; fresh stay waiting', () => {
		const now = Date.now();
		insertWaiting(waitingRow({ id: 'a2a-stale', toSession: 'session-a', sentAt: now - 3_600_000 }));
		insertWaiting(waitingRow({ id: 'a2a-fresh', toSession: 'session-a', sentAt: now - 100 }));
		sweepOnBoot();
		const stale = getRow('a2a-stale');
		expect(stale?.state).toBe('timeout');
		expect(stale?.error).toContain('boot sweep');
		expect(getRow('a2a-fresh')?.state).toBe('waiting');
	});

	it('span capture — turns lane joins the whole exchange when the prompt is on the page', async () => {
		const page = {
			events: [
				{
					event: {
						type: 'user/message',
						seq: 10,
						time: 1_000,
						data: {
							content: [
								{
									type: 'text',
									text: 'run it. Protocol: end your reply with exactly this signature as the final characters: _a2a_:a2a-turnspan;'
								}
							]
						}
					}
				},
				{
					event: {
						type: 'assistant/message',
						seq: 11,
						time: 1_100,
						data: {
							turn: 2,
							step: 0,
							message: { content: [{ type: 'text', text: 'Finding the actual file:' }] }
						}
					}
				},
				{
					event: {
						type: 'assistant/message',
						seq: 12,
						time: 1_200,
						data: {
							turn: 2,
							step: 0,
							message: { content: [{ type: 'text', text: 'Done — full picture. _a2a_:a2a-turnspan;' }] }
						}
					}
				}
			],
			hasMore: false
		};
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: 1 })],
			historyBySession: { 'session-a': page }
		});
		configureWatcher({ dsh: fake });
		insertWaiting(waitingRow({ id: 'a2a-turnspan', toSession: 'session-a', watermarkTurn: 0 }));
		await tick();
		const row = getRow('a2a-turnspan');
		expect(row?.state).toBe('replied_exact');
		expect(row?.replyText).toContain('Finding the actual file:');
		expect(row?.replyText).toContain('Done — full picture.');
		expect(row?.replyText?.endsWith('_a2a_:a2a-turnspan;')).toBe(true);
		expect(row?.error).toBeNull(); // turns present — no degrade note
	});

	it('ZERO model calls — no prompt RPC in any watcher path (spy)', async () => {
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: 1 })],
			historyBySession: { 'session-a': historyPage('ok _a2a_:a2a-z;') }
		});
		configureWatcher({ dsh: fake });
		insertWaiting(waitingRow({ id: 'a2a-z', toSession: 'session-a', watermarkTurn: 0 }));
		await tick();
		sweepOnBoot();
		expect(fake.prompt).not.toHaveBeenCalled();
	});
});

// ── SEQ lane (2026-08-25 bug fix) — the live-host world: no sessionStats,
//    list updatedAt/running frozen — the ledger seq is the only motion. ──

describe('a2a-watcher — SEQ lane (2026-08-25 fix)', () => {
	// Quiescence semantics (RCA follow-up): the FIRST probe records the
	// tail and never settles; a settle needs a second probe seeing the
	// SAME tail. Tests below shrink probeWindowMs/quiescenceMs to 0 so
	// consecutive ticks probe and settle immediately; the default-gate
	// test proves the production timing holds.
	const fastLane = { probeWindowMs: 0, quiescenceMs: 0 } as const;

	it('dead LIST gate + seq watermark → exact settle with the seq degrade note', async () => {
		// The live-host shape probe-verified 2026-08-25: turns null,
		// updatedAt frozen PRE-send, running never true mid-turn.
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: null, updatedAt: 1_000 })],
			historyBySession: { 'session-a': historyPage('done — _a2a_:a2a-seq1;', 40) }
		});
		configureWatcher({ dsh: fake, ...fastLane });
		insertWaiting(
			waitingRow({ id: 'a2a-seq1', toSession: 'session-a', watermarkTurn: -1, watermarkSeq: 39 })
		);
		await tick(); // probe 1 — records the tail, no settle (quiescence)
		expect(getRow('a2a-seq1')?.state).toBe('waiting');
		await tick(); // probe 2 — same tail, quiet → settle
		const row = getRow('a2a-seq1');
		expect(row?.state).toBe('replied_exact');
		expect(row?.replyText).toContain('_a2a_:a2a-seq1;');
		expect(row?.replyTurn).toBe(1);
		expect(row?.error).toContain('ledger seq watermark');
	});

	it('no signature past the watermark → replied_approx (never confident)', async () => {
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: null, updatedAt: 1_000 })],
			historyBySession: { 'session-a': historyPage('all done', 41) }
		});
		configureWatcher({ dsh: fake, ...fastLane });
		insertWaiting(
			waitingRow({ id: 'a2a-seq2', toSession: 'session-a', watermarkTurn: -1, watermarkSeq: 39 })
		);
		await tick();
		await tick();
		expect(getRow('a2a-seq2')?.state).toBe('replied_approx');
	});

	it('reply at-or-below the watermark stays waiting — silence is never success', async () => {
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: null, updatedAt: 1_000 })],
			historyBySession: { 'session-a': historyPage('older reply', 39) }
		});
		configureWatcher({ dsh: fake, ...fastLane });
		insertWaiting(
			waitingRow({ id: 'a2a-seq3', toSession: 'session-a', watermarkTurn: -1, watermarkSeq: 39 })
		);
		await tick();
		await tick();
		expect(getRow('a2a-seq3')?.state).toBe('waiting');
	});

	it('throttled — one history probe per target per window, second tick reads nothing', async () => {
		const page = historyPage('done _a2a_:a2a-seq4;', 40);
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: null, updatedAt: 1_000 })],
			historyBySession: { 'session-a': page }
		});
		configureWatcher({ dsh: fake }); // DEFAULT window (5s) — real clock
		insertWaiting(
			waitingRow({ id: 'a2a-seq4', toSession: 'session-a', watermarkTurn: -1, watermarkSeq: 39 })
		);
		await tick(); // probe 1 — records the tail (no settle under quiescence)
		expect(getRow('a2a-seq4')?.state).toBe('waiting');
		// A second waiting row for the SAME target: immediate tick must NOT
		// re-probe (window closed) — no history read, both rows stay waiting.
		insertWaiting(
			waitingRow({ id: 'a2a-seq5', toSession: 'session-a', watermarkTurn: -1, watermarkSeq: 39 })
		);
		const readsBefore = fake.historyCalls;
		await tick();
		expect(fake.historyCalls).toBe(readsBefore);
		expect(getRow('a2a-seq5')?.state).toBe('waiting');
	});

	it('no watermarkSeq + dead LIST gate → stays waiting (deadline owns)', async () => {
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: null, updatedAt: 1_000 })],
			historyBySession: { 'session-a': historyPage('unseen reply', 99) }
		});
		configureWatcher({ dsh: fake, ...fastLane });
		insertWaiting(waitingRow({ id: 'a2a-seq6', toSession: 'session-a', watermarkTurn: -1 }));
		await tick();
		await tick();
		expect(fake.historyCalls).toBe(0); // nothing eligible to probe
		expect(getRow('a2a-seq6')?.state).toBe('waiting');
	});

	it('default quiescence — a same-tail second tick within 3s still waits', async () => {
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: null, updatedAt: 1_000 })],
			historyBySession: { 'session-a': historyPage('final answer _a2a_:a2a-def;', 40) }
		});
		configureWatcher({ dsh: fake, probeWindowMs: 0 }); // probe every tick, DEFAULT 3s quiescence
		insertWaiting(
			waitingRow({ id: 'a2a-def', toSession: 'session-a', watermarkTurn: -1, watermarkSeq: 39 })
		);
		await tick(); // records tail
		await tick(); // same tail but quiet < 3s (real clock) → still waits
		expect(getRow('a2a-def')?.state).toBe('waiting');
	});

	it('quiescence gate — a moving tail never settles; the quiet FINAL message does (risk 1)', async () => {
		// Scripted pages: probe 1 sees a mid-turn fragment (tail 40);
		// probe 2 sees the turn still writing (tail 41 — the final message
		// landed but the tail moved THIS window → record, no settle);
		// probe 3 sees the same tail 41 quiet → settles on the FINAL text.
		const midTurn = historyPage('It is a directory. Let me look inside.', 40);
		const finalPage = {
			events: [
				...midTurn.events,
				{
					event: {
						type: 'assistant/message',
						seq: 41,
						time: 3_000,
						data: {
							turn: 1,
							step: 1,
							message: { content: [{ type: 'text', text: 'All done — _a2a_:a2a-quiet1;' }] }
						}
					}
				}
			],
			hasMore: false
		};
		const queue = [midTurn, finalPage, finalPage];
		const fake: FakeDsh = {
			listCalls: 0,
			historyCalls: 0,
			prompt: vi.fn(async () => ({ accepted: true })),
			async listSessions() {
				fake.listCalls++;
				return { items: [spineRow({ sessionId: 'session-a', turns: null, updatedAt: 1_000 })] };
			},
			async history() {
				fake.historyCalls++;
				return queue.shift() ?? finalPage;
			}
		};
		configureWatcher({ dsh: fake, ...fastLane });
		insertWaiting(
			waitingRow({ id: 'a2a-quiet1', toSession: 'session-a', watermarkTurn: -1, watermarkSeq: 39 })
		);
		await tick(); // tail 40 first sight → record
		await tick(); // tail 41 MOVED → record, no settle (fragment protection)
		expect(getRow('a2a-quiet1')?.state).toBe('waiting');
		await tick(); // tail 41 quiet → settle, span-joining the WHOLE turn
		const row = getRow('a2a-quiet1');
		expect(row?.state).toBe('replied_exact');
		// SPAN capture (2026-08-25 RCA #2): quiescence governs WHEN we
		// settle (never mid-write — asserted waiting above); the span
		// governs WHAT we store. The fragment is part of the same turn,
		// so the settled text joins it with the quiet final message —
		// attribution still comes from the END signature alone.
		expect(row?.replyText).toContain('directory');
		expect(row?.replyText).toContain('All done');
		expect(row?.replyText?.endsWith('All done — _a2a_:a2a-quiet1;')).toBe(true);
	});

	it('span capture — prompt anchor beats a late registration watermark (RCA #2 live shape)', async () => {
		// The a2a-30b51db8 anatomy: prompt (seq 50) carries the protocol
		// line; an empty tool-call bubble (51); narration BELOW the
		// register-time watermark (52 < 55 — registration landed seconds
		// after the prompt, the target already narrating); more narration
		// (60); the final digest (70). The span must anchor at the PROMPT
		// (50), not the watermark (55) — else 52 is stranded forever.
		const span = {
			events: [
				{
					event: {
						type: 'user/message',
						seq: 50,
						time: 1_000,
						data: {
							content: [
								{
									type: 'text',
									text: 'load the spec. Protocol: end your reply with exactly this signature as the final characters: _a2a_:a2a-span1;'
								}
							]
						}
					}
				},
				{
					event: {
						type: 'assistant/message',
						seq: 51,
						time: 1_100,
						data: { turn: 2, step: 0, message: { content: [{ type: 'text', text: '' }] } }
					}
				},
				{
					event: {
						type: 'assistant/message',
						seq: 52,
						time: 1_200,
						data: {
							turn: 2,
							step: 0,
							message: { content: [{ type: 'text', text: 'Exact name did not match — finding the actual file:' }] }
						}
					}
				},
				{
					event: {
						type: 'assistant/message',
						seq: 60,
						time: 1_300,
						data: {
							turn: 2,
							step: 0,
							message: { content: [{ type: 'text', text: 'They are directories — looking inside:' }] }
						}
					}
				},
				{
					event: {
						type: 'assistant/message',
						seq: 70,
						time: 1_400,
						data: {
							turn: 2,
							step: 0,
							message: { content: [{ type: 'text', text: 'Spec loaded — full picture follows. _a2a_:a2a-span1;' }] }
						}
					}
				}
			],
			hasMore: false
		};
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: null, updatedAt: 1_000 })],
			historyBySession: { 'session-a': span }
		});
		configureWatcher({ dsh: fake, ...fastLane });
		insertWaiting(
			waitingRow({ id: 'a2a-span1', toSession: 'session-a', watermarkTurn: -1, watermarkSeq: 55 })
		);
		await tick(); // probe 1 — records the tail
		await tick(); // probe 2 — quiet → settle the span
		const row = getRow('a2a-span1');
		expect(row?.state).toBe('replied_exact');
		const text = row?.replyText ?? '';
		// narration BELOW the register watermark (52 < 55) is captured…
		expect(text).toContain('Exact name did not match');
		expect(text).toContain('They are directories');
		expect(text).toContain('Spec loaded');
		// …in chronological order, empty bubbles dropped, sig still the end
		expect(text.indexOf('Exact name')).toBeLessThan(text.indexOf('They are'));
		expect(text.indexOf('They are')).toBeLessThan(text.indexOf('Spec loaded'));
		expect(text.endsWith('_a2a_:a2a-span1;')).toBe(true);
		expect(row?.replyTurn).toBe(2);
		expect(row?.error).toContain('ledger seq watermark');
	});

	it('span capture — a LATER delegation prompt bounds the span (stacked mentions stay separate)', async () => {
		const stacked = {
			events: [
				{
					event: {
						type: 'user/message',
						seq: 50,
						time: 1_000,
						data: {
							content: [
								{
									type: 'text',
									text: 'first task. Protocol: end your reply with exactly this signature as the final characters: _a2a_:a2a-stk1;'
								}
							]
						}
					}
				},
				{
					event: {
						type: 'assistant/message',
						seq: 55,
						time: 1_100,
						data: {
							turn: 1,
							step: 0,
							message: { content: [{ type: 'text', text: 'Answer one — done. _a2a_:a2a-stk1;' }] }
						}
					}
				},
				{
					event: {
						type: 'user/message',
						seq: 60,
						time: 1_200,
						data: {
							content: [
								{
									type: 'text',
									text: 'second task. Protocol: end your reply with exactly this signature as the final characters: _a2a_:a2a-stk2;'
								}
							]
						}
					}
				},
				{
					event: {
						type: 'assistant/message',
						seq: 65,
						time: 1_300,
						data: {
							turn: 2,
							step: 0,
							message: { content: [{ type: 'text', text: 'Answer two — done. _a2a_:a2a-stk2;' }] }
						}
					}
				}
			],
			hasMore: false
		};
		const fake = fakeDsh({
			items: [spineRow({ sessionId: 'session-a', turns: null, updatedAt: 1_000 })],
			historyBySession: { 'session-a': stacked }
		});
		configureWatcher({ dsh: fake, ...fastLane });
		insertWaiting(
			waitingRow({ id: 'a2a-stk1', toSession: 'session-a', watermarkTurn: -1, watermarkSeq: 49 })
		);
		insertWaiting(
			waitingRow({ id: 'a2a-stk2', toSession: 'session-a', watermarkTurn: -1, watermarkSeq: 59 })
		);
		await tick();
		await tick();
		const one = getRow('a2a-stk1');
		const two = getRow('a2a-stk2');
		expect(one?.state).toBe('replied_exact');
		expect(two?.state).toBe('replied_exact');
		// Each span stops at the NEXT delegation prompt — no swallowing.
		expect(one?.replyText).toContain('Answer one');
		expect(one?.replyText).not.toContain('Answer two');
		expect(two?.replyText).toContain('Answer two');
		expect(two?.replyText).not.toContain('Answer one');
	});
});
