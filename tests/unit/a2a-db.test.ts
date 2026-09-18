/**
 * a2a-db tests (Task 2.1-T) — the ledger's binding contracts: idempotent
 * DDL, INSERT-at-send, single settle, terminal guard, waiting index,
 * retention (waiting rows survive), env override.
 * Node env (environmentMatchGlobs) — node:sqlite externalized (Task 2.1).
 *
 * Spec: dev/specs/2026-08-25 - DSI a2a Signature and Delegation Ledger
 *      (PRD "DB contract"; Tasks 2.1/2.1-T).
 */

import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	__resetA2aDbCache,
	A2A_DB_ENV,
	type A2aInsertWaiting,
	getRow,
	insertWaiting,
	listRecent,
	listWaiting,
	openA2aDb,
	pruneTerminalBefore,
	settleRow
} from '$lib/server/a2a/db.js';

let tmpRoot: string;

beforeEach(() => {
	// Fresh tmp file per test — vitest file-level isolation keeps env seams race-free.
	tmpRoot = mkdtempSync(join(tmpdir(), 'dsi-a2a-db-'));
	process.env[A2A_DB_ENV] = join(tmpRoot, 'a2a.sqlite');
	__resetA2aDbCache();
});

afterAll(() => {
	delete process.env[A2A_DB_ENV];
	__resetA2aDbCache();
});

function row(overrides: Partial<A2aInsertWaiting> = {}): A2aInsertWaiting {
	return {
		id: 'a2a-deadbeefdeadbeef',
		fromSession: 'session-from',
		toSession: 'session-to',
		message: 'run the tests',
		watermarkTurn: 4,
		sentAt: Date.now(),
		...overrides
	};
}

describe('openA2aDb — DDL idempotent', () => {
	it('creates the file and re-opens cleanly (open twice)', () => {
		const p = join(tmpRoot, 'idem.sqlite');
		const db1 = openA2aDb(p);
		insertWaiting(row(), db1);
		expect(statSync(p).isFile()).toBe(true);
		// Second open on the same path: DDL re-runs as a no-op, data survives.
		const db2 = openA2aDb(p);
		expect(listWaiting(db2).length).toBe(1);
	});

	it('memoizes the no-arg default handle and honors a fresh env after reset', () => {
		const a = openA2aDb();
		const b = openA2aDb();
		expect(a).toBe(b); // memoized per process
		__resetA2aDbCache();
		tmpRoot = mkdtempSync(join(tmpdir(), 'dsi-a2a-db-'));
		process.env[A2A_DB_ENV] = join(tmpRoot, 'fresh.sqlite');
		const c = openA2aDb();
		expect(c).not.toBe(a);
	});
});

describe('INSERT → settle lifecycle', () => {
	it('inserts a waiting row with the exact contract shape', () => {
		const db = openA2aDb();
		insertWaiting(row(), db);
		const w = listWaiting(db);
		expect(w.length).toBe(1);
		expect(w[0].state).toBe('waiting');
		expect(w[0].replyText).toBeNull();
		// SQL columns per ADR §6 + watermark_seq (2026-08-25 seq-lane fix;
		// snake_case on disk).
		const raw = db.prepare('SELECT * FROM a2a_exchange').get() as Record<string, unknown>;
		expect(Object.keys(raw).sort()).toEqual([
			'error',
			'from_session',
			'id',
			'message',
			'reply_text',
			'reply_turn',
			'sent_at',
			'settled_at',
			'state',
			'to_session',
			'watermark_seq',
			'watermark_turn'
		]);
	});

	it('settles once with full attribution, then refuses a second settle', () => {
		const db = openA2aDb();
		insertWaiting(row(), db);
		settleRow(
			{ id: row().id, state: 'replied_exact', replyText: 'done _a2a_:a2a-deadbeefdeadbeef;', replyTurn: 5 },
			db
		);
		const settled = getRow(row().id, db);
		expect(settled?.state).toBe('replied_exact');
		expect(settled?.replyText).toContain('_a2a_:');
		expect(settled?.replyTurn).toBe(5);
		expect(settled?.settledAt).not.toBeNull();
		expect(settled?.error).toBeNull();
		// Double settle: refused loudly, row not rewritten.
		expect(() => settleRow({ id: row().id, state: 'timeout' }, db)).toThrow(/terminal/);
		expect(getRow(row().id, db)?.state).toBe('replied_exact');
	});

	it('terminal guard: every terminal state is settled-once — later settles refused', () => {
		const db = openA2aDb();
		for (const state of ['replied_exact', 'replied', 'replied_approx', 'timeout', 'gone'] as const) {
			insertWaiting(row({ id: `a2a-term-${state}` }), db);
			settleRow({ id: `a2a-term-${state}`, state }, db);
			for (const next of ['replied', 'timeout', 'gone'] as const) {
				if (next === state) continue;
				expect(() => settleRow({ id: `a2a-term-${state}`, state: next }, db)).toThrow(/refused/);
			}
			expect(getRow(`a2a-term-${state}`, db)?.state).toBe(state);
		}
	});

	it("refuses settling a row that doesn't exist", () => {
		const db = openA2aDb();
		expect(() => settleRow({ id: 'a2a-nosuch', state: 'timeout' }, db)).toThrow(/not found/);
	});

	it('refuses `waiting` as a settle state (runtime guard for untyped callers)', () => {
		const db = openA2aDb();
		insertWaiting(row(), db);
		// The interface excludes 'waiting' at compile time; cast through
		// unknown to exercise the runtime refusal path a JS caller hits.
		const badSettle = { id: row().id, state: 'waiting' } as unknown as Parameters<typeof settleRow>[0];
		expect(() => settleRow(badSettle, db)).toThrow(/not a settle state/);
		expect(getRow(row().id, db)?.state).toBe('waiting'); // row untouched
	});
});

describe('waiting index', () => {
	it('queries waiting rows via the partial index (EXPLAIN QUERY PLAN)', () => {
		const db = openA2aDb();
		const plan = db
			.prepare(`EXPLAIN QUERY PLAN SELECT * FROM a2a_exchange WHERE state = 'waiting' ORDER BY sent_at ASC`)
			.all() as Array<{ detail: string }>;
		const joined = plan.map((p) => p.detail).join(' | ');
		// SQLite plan semantics: `SCAN tbl USING INDEX idx` IS the indexed path;
		// only a bare `SCAN tbl` (no USING) is a full table scan.
		expect(joined).toMatch(/USING INDEX idx_a2a_waiting/);
		expect(joined).not.toMatch(/SCAN a2a_exchange(?! USING INDEX)/);
	});

	it('hides settled rows from listWaiting', () => {
		const db = openA2aDb();
		insertWaiting(row({ id: 'a2a-w1', sentAt: 1 }), db);
		insertWaiting(row({ id: 'a2a-w2', sentAt: 2 }), db);
		settleRow({ id: 'a2a-w1', state: 'timeout' }, db);
		expect(listWaiting(db).map((r) => r.id)).toEqual(['a2a-w2']);
	});
});

describe('retention prune', () => {
	it('prunes terminal rows settled before cutoff and KEEPS waiting rows', () => {
		const db = openA2aDb();
		insertWaiting(row({ id: 'a2a-old-settled', sentAt: 1 }), db);
		insertWaiting(row({ id: 'a2a-old-waiting', sentAt: 1 }), db);
		insertWaiting(row({ id: 'a2a-new-settled', sentAt: 2 }), db);
		// Settle two rows at different settled_at times: old at t=100, new at t=999.
		const dateSpy = vi.spyOn(Date, 'now');
		dateSpy.mockReturnValue(100);
		settleRow({ id: 'a2a-old-settled', state: 'timeout' }, db);
		dateSpy.mockReturnValue(999);
		settleRow({ id: 'a2a-new-settled', state: 'replied' }, db);
		dateSpy.mockRestore();
		const pruned = pruneTerminalBefore(500, db);
		expect(pruned).toBe(1);
		expect(getRow('a2a-old-settled', db)).toBeNull(); // pruned
		expect(getRow('a2a-old-waiting', db)?.state).toBe('waiting'); // waiting survives retention
		expect(getRow('a2a-new-settled', db)?.state).toBe('replied'); // settled after cutoff survives
	});
});

describe('env override honored', () => {
	it('DSI_A2A_DB env points the default handle at the tmp file', () => {
		const target = join(tmpRoot, 'env.sqlite');
		process.env[A2A_DB_ENV] = target;
		__resetA2aDbCache();
		const db = openA2aDb(); // no explicit path → env applies
		insertWaiting(row(), db);
		expect(statSync(target).isFile()).toBe(true);
		// Explicit path wins over env.
		const explicit = join(tmpRoot, 'explicit.sqlite');
		openA2aDb(explicit);
		expect(statSync(explicit).isFile()).toBe(true);
	});

	it('db file is a sibling of DSI_CONFIG_PATH when no override (source-verified, no write)', () => {
		// resolveA2aDbPath's default branch joins dirname(DSI_CONFIG_PATH).
		// Probed in-source: a default-path open here would point the whole
		// vitest process's memoized handle at ~/.dsi/a2a.sqlite.
		const src = readFileSync(join('src', 'lib', 'server', 'a2a', 'db.ts'), 'utf8');
		expect(src).toContain('join(dirname(DSI_CONFIG_PATH), A2A_DB_FILENAME)');
	});
});

describe('listRecent', () => {
	it('returns rows newest-first with optional from-filter and limit', () => {
		const db = openA2aDb();
		insertWaiting(row({ id: 'a2a-r1', sentAt: 10 }), db);
		insertWaiting(row({ id: 'a2a-r2', sentAt: 20, fromSession: 'other' }), db);
		insertWaiting(row({ id: 'a2a-r3', sentAt: 30 }), db);
		expect(listRecent(20, undefined, db).map((r) => r.id)).toEqual(['a2a-r3', 'a2a-r2', 'a2a-r1']);
		expect(listRecent(20, 'other', db).map((r) => r.id)).toEqual(['a2a-r2']);
		expect(listRecent(1, undefined, db).map((r) => r.id)).toEqual(['a2a-r3']);
	});
});

// ── v1→v2 migration + seq watermark round-trip (2026-08-25 fix) ──────────

describe('a2a-db — watermark_seq (2026-08-25 fix)', () => {
	it('round-trips watermark_seq (set and null)', () => {
		insertWaiting({
			id: 'a2a-seq-a',
			fromSession: 'session-s',
			toSession: 'session-t',
			message: 'go',
			watermarkTurn: -1,
			watermarkSeq: 81,
			sentAt: 1_000
		});
		insertWaiting({
			id: 'a2a-seq-b',
			fromSession: 'session-s',
			toSession: 'session-t',
			message: 'go',
			watermarkTurn: -1,
			sentAt: 1_001
		});
		expect(getRow('a2a-seq-a')?.watermarkSeq).toBe(81);
		expect(getRow('a2a-seq-b')?.watermarkSeq).toBeNull();
	});

	it('migrates a v1 ledger (no watermark_seq column) in place', () => {
		// Build a v1 file by hand — the pre-fix schema, exactly.
		const v1 = new DatabaseSync(process.env[A2A_DB_ENV]!, { readOnly: false });
		v1.exec(`CREATE TABLE a2a_exchange (
			id TEXT PRIMARY KEY,
			from_session TEXT NOT NULL,
			to_session TEXT NOT NULL,
			message TEXT NOT NULL,
			watermark_turn INTEGER NOT NULL,
			sent_at INTEGER NOT NULL,
			state TEXT NOT NULL DEFAULT 'waiting',
			reply_text TEXT,
			reply_turn INTEGER,
			settled_at INTEGER,
			error TEXT
		)`);
		v1.prepare(
			`INSERT INTO a2a_exchange (id, from_session, to_session, message, watermark_turn, sent_at, state)
			 VALUES ('a2a-v1', 's', 't', 'old row', -1, 1, 'waiting')`
		).run();
		v1.close();
		// Re-open through the module: DDL no-ops, ALTER adds the column.
		__resetA2aDbCache();
		const row = getRow('a2a-v1');
		expect(row?.watermarkSeq).toBeNull(); // v1 row survives, new column NULL
		insertWaiting({
			id: 'a2a-v2',
			fromSession: 's',
			toSession: 't',
			message: 'new row',
			watermarkTurn: -1,
			watermarkSeq: 7,
			sentAt: 2
		});
		expect(getRow('a2a-v2')?.watermarkSeq).toBe(7);
	});
});
