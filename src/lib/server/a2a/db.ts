/**
 * a2a-db (2026-08-25) — the Delegation Ledger: one row per @session
 * delegation, INSERT-at-send, exactly one settle UPDATE, never rewritten
 * after settle. This file owns the schema and nothing else — the watcher
 * (W3) decides WHEN rows settle; the matcher (W2) decides the tier.
 *
 * ADR: dev/architectural-decission/2026-08-26 - The a2a Signature —
 *      Correlation IDs and the Delegation Ledger.md §6 (binding data
 *      contract: columns, partial waiting index, single settle).
 * Spec: dev/specs/2026-08-25 - DSI a2a Signature and Delegation Ledger
 *      (PRD "DB contract"; Tasks 2.1/2.1-T).
 *
 * Storage: node:sqlite DatabaseSync, WAL, zero new npm deps. File lives
 * at `~/.dsi/a2a.sqlite` (DSI_CONFIG_PATH sibling); `DSI_A2A_DB`
 * env override is the test seam (each node-env-globed test file sets it
 * to a tmp path before first open — vitest isolates files, so no races).
 *
 * Module boundary (PRD communication map): this module imports the
 * config layer only (for the directory) — never dsh-connection, never
 * dsh-rpc; nothing imports INTO here except watcher/routes.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DSI_CONFIG_PATH } from '$lib/server/insight-config.js';

/** Ledger filename under `~/.dsi/` (ADR §6 binding contract). */
export const A2A_DB_FILENAME = 'a2a.sqlite';

/** Test seam: explicit env override for the db file location. */
export const A2A_DB_ENV = 'DSI_A2A_DB';

/**
 * Resolve the ledger path: explicit argument → `DSI_A2A_DB` env →
 * sibling of DSI_CONFIG_PATH (`~/.dsi/a2a.sqlite`).
 */
export function resolveA2aDbPath(path?: string): string {
	return path ?? process.env[A2A_DB_ENV] ?? join(dirname(DSI_CONFIG_PATH), A2A_DB_FILENAME);
}

// ── Row state vocabulary (PRD tier contract — every state names its certainty) ──

/** One honest word per outcome; `replied_exact` ≠ `replied_approx`, ever. */
export type A2aState =
	| 'waiting'
	| 'replied_exact'
	| 'replied'
	| 'replied_approx'
	| 'timeout'
	| 'gone';

/** Every state except `waiting` is terminal — settled rows never change. */
export const TERMINAL_A2A_STATES: readonly A2aState[] = [
	'replied_exact',
	'replied',
	'replied_approx',
	'timeout',
	'gone'
] as const;

/** The shape stored (SQL columns per ADR §6 + the seq-watermark fix
 *  2026-08-25: `watermark_seq` is the target ledger's newest event seq at
 *  send — the fallback watermark when the spine row carries no `turns`
 *  (live hosts ship no sessionStats; probe-verified 2026-08-25). */
export interface A2aExchangeRow {
	id: string;
	fromSession: string;
	toSession: string;
	message: string;
	/** Spine `turns` at send; -1 when the spine row had no turns (honest). */
	watermarkTurn: number;
	/** Target ledger newest event seq at send; null when unavailable. */
	watermarkSeq: number | null;
	sentAt: number;
	state: A2aState;
	replyText: string | null;
	replyTurn: number | null;
	settledAt: number | null;
	error: string | null;
}

/** INSERT-at-send payload (state is always born `waiting`). The seq
 *  watermark is optional — absent means NULL (deadline-owned row). */
export type A2aInsertWaiting = Omit<
	A2aExchangeRow,
	'state' | 'replyText' | 'replyTurn' | 'settledAt' | 'error' | 'watermarkSeq'
> & { watermarkSeq?: number | null };

/** Settle payload — exactly one per row, terminal states only. */
export interface A2aSettle {
	state: Exclude<A2aState, 'waiting'>;
	replyText?: string;
	replyTurn?: number;
	/** Honest text for timeout/degrade lanes — silence is never failure. */
	error?: string;
}

// ── Schema (idempotent — safe on every open; ADR §6 column set is exact) ──

const DDL = [
	`CREATE TABLE IF NOT EXISTS a2a_exchange (
		id TEXT PRIMARY KEY,
		from_session TEXT NOT NULL,
		to_session TEXT NOT NULL,
		message TEXT NOT NULL,
		watermark_turn INTEGER NOT NULL,
		watermark_seq INTEGER,
		sent_at INTEGER NOT NULL,
		state TEXT NOT NULL DEFAULT 'waiting',
		reply_text TEXT,
		reply_turn INTEGER,
		settled_at INTEGER,
		error TEXT
	)`,
	// Partial index: the watcher's LIST lane reads waiting rows every tick.
	`CREATE INDEX IF NOT EXISTS idx_a2a_waiting
		ON a2a_exchange (sent_at)
		WHERE state = 'waiting'`
].join(';\n');

/** v1→v2 (2026-08-25 bug fix): add watermark_seq to pre-fix ledgers. */
const MIGRATE_V2 = `ALTER TABLE a2a_exchange ADD COLUMN watermark_seq INTEGER`;

/**
 * Open (and ensure) the ledger. Idempotent: DDL re-runs safely, so a
 * second open of the same file is a no-op schema-wise (Task 2.1-T probe).
 *
 * Caching: an explicit `path` always returns a FRESH handle (test/tmp
 * isolation); the no-arg form memoizes one default handle per process —
 * the watcher and routes share it.
 */
let defaultDb: DatabaseSync | null = null;

export function openA2aDb(path?: string): DatabaseSync {
	if (path === undefined && defaultDb !== null) return defaultDb;
	const file = resolveA2aDbPath(path);
	// DatabaseSync creates the file but not its directory (OCI precedent).
	mkdirSync(dirname(file), { recursive: true });
	const db = new DatabaseSync(file, { readOnly: false });
	db.exec('PRAGMA journal_mode = WAL;');
	db.exec(`${DDL};`);
	// v1→v2 migration: pre-fix ledgers lack watermark_seq (duplicate-column
	// errors are the already-migrated case — swallowed, idempotent by try).
	try {
		db.exec(MIGRATE_V2);
	} catch {
		// column exists — nothing to do
	}
	if (path === undefined) defaultDb = db;
	return db;
}

/** Test-only: drop the memoized default (fresh env → fresh handle). */
export function __resetA2aDbCache(): void {
	defaultDb = null;
}

// ── Row mapping (SQL snake_case ↔ TS camelCase) ──

function mapRow(r: Record<string, unknown>): A2aExchangeRow {
	return {
		id: r.id as string,
		fromSession: r.from_session as string,
		toSession: r.to_session as string,
		message: r.message as string,
		watermarkTurn: r.watermark_turn as number,
		watermarkSeq: (r.watermark_seq ?? null) as number | null,
		sentAt: r.sent_at as number,
		state: r.state as A2aState,
		replyText: (r.reply_text ?? null) as string | null,
		replyTurn: (r.reply_turn ?? null) as number | null,
		settledAt: (r.settled_at ?? null) as number | null,
		error: (r.error ?? null) as string | null
	};
}

// ── Public API (thin, typed; no business decisions live here) ──

/** INSERT one waiting row — the send itself (ADR §6: INSERT-at-send). */
export function insertWaiting(row: A2aInsertWaiting, db: DatabaseSync = openA2aDb()): void {
	db.prepare(
		`INSERT INTO a2a_exchange
			(id, from_session, to_session, message, watermark_turn, watermark_seq, sent_at, state)
			VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting')`
	).run(
		row.id,
		row.fromSession,
		row.toSession,
		row.message,
		row.watermarkTurn,
		row.watermarkSeq ?? null,
		row.sentAt
	);
}

/**
 * Settle a row — exactly once. Refuses: unknown id, a `waiting` target
 * state, or an already-terminal row (single-UPDATE guard: the WHERE
 * clause pins `state='waiting'`, so the database itself rejects any
 * second settle — no rewrites after settle, by construction).
 */
export function settleRow(settle: A2aSettle & { id: string }, db: DatabaseSync = openA2aDb()): void {
	const { id, state, replyText, replyTurn, error } = settle;
	// Type-system belt + runtime braces: A2aSettle already excludes 'waiting',
	// but this function is the single settle gate — the explicit check keeps
	// JS callers honest (the interface narrows, the guard refuses).
	if ((state as A2aState) === 'waiting') {
		throw new Error(`a2a settle refused for ${id}: 'waiting' is not a settle state`);
	}
	const result = db
		.prepare(
			`UPDATE a2a_exchange
				SET state = ?, reply_text = ?, reply_turn = ?, settled_at = ?, error = ?
				WHERE id = ? AND state = 'waiting'`
		)
		.run(state, replyText ?? null, replyTurn ?? null, Date.now(), error ?? null, id);
	if (result.changes !== 1) {
		const current = db
			.prepare('SELECT state FROM a2a_exchange WHERE id = ?')
			.get(id) as { state: string } | undefined;
		if (current === undefined) throw new Error(`a2a settle refused for ${id}: row not found`);
		throw new Error(`a2a settle refused for ${id}: row is terminal ('${current.state}') — settled rows never change`);
	}
}

/** All waiting rows, oldest first (the watcher's LIST-lane input). */
export function listWaiting(db: DatabaseSync = openA2aDb()): A2aExchangeRow[] {
	const rows = db
		.prepare(`SELECT * FROM a2a_exchange WHERE state = 'waiting' ORDER BY sent_at ASC`)
		.all() as Record<string, unknown>[];
	return rows.map(mapRow);
}

/** Recent rows, newest first — the read API's list (optional sender filter).
 * rowid DESC breaks same-ms ties: the later INSERT is the newer row. */
export function listRecent(limit = 20, fromSession?: string, db: DatabaseSync = openA2aDb()): A2aExchangeRow[] {
	const sql = fromSession
		? `SELECT * FROM a2a_exchange WHERE from_session = ? ORDER BY sent_at DESC, rowid DESC LIMIT ?`
		: `SELECT * FROM a2a_exchange ORDER BY sent_at DESC, rowid DESC LIMIT ?`;
	const stmt = db.prepare(sql);
	const rows = (
		fromSession ? stmt.all(fromSession, limit) : stmt.all(limit)
	) as Record<string, unknown>[];
	return rows.map(mapRow);
}

/** One row or null. */
export function getRow(id: string, db: DatabaseSync = openA2aDb()): A2aExchangeRow | null {
	const r = db.prepare('SELECT * FROM a2a_exchange WHERE id = ?').get(id) as
		| Record<string, unknown>
		| undefined;
	return r ? mapRow(r) : null;
}

/**
 * Retention (boot sweep only, W3): delete TERMINAL rows settled strictly
 * before the cutoff. Waiting rows are never pruned — an unresolved watch
 * outranks retention. Returns the number pruned.
 */
export function pruneTerminalBefore(cutoffMs: number, db: DatabaseSync = openA2aDb()): number {
	const result = db
		.prepare(
			`DELETE FROM a2a_exchange
				WHERE state != 'waiting' AND settled_at IS NOT NULL AND settled_at < ?`
		)
		.run(cutoffMs);
	// node:sqlite returns count as number | bigint (large counts); the
	// ledger's row counts are plain numbers — coerce once at the boundary.
	return Number(result.changes);
}
