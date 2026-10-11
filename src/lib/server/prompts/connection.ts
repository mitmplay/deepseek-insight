/**
 * prompts-db connection (2026-10-10) — lifecycle half of the Shelf, moved
 * WHOLE from db.ts (ADR-0019 standard, ADR-0022 W1). Path resolution
 * (explicit arg -> DSI_PROMPTS_DB env -> settings dbPath -> ~/.dsi default,
 * ~/ expanded), version-gated migrate, the cached default handle, and the
 * close/reset test seams. Degrade contract: never throws to a route —
 * failures are warned and return null/false.
 *
 * Moved verbatim from db.ts by line range; private helpers widened to
 * default-public where siblings import them (sanctioned seam, no signature
 * changes).
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DSI_CONFIG_PATH, readPromptsConfig } from '$lib/server/insight-config.js';

/** Library filename under `~/.dsi/`. */
export const PROMPTS_DB_FILENAME = 'prompts.sqlite';

/** Test seam: explicit env override for the db file location. */
export const PROMPTS_DB_ENV = 'DSI_PROMPTS_DB';

/** Expand a leading `~` to the home directory (config users write
 *  `prompts.dbPath: ~/library/prompts.sqlite` and expect the shell rule). */
function expandHome(p: string): string {
	return p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p;
}

/**
 * Resolve the library path: explicit argument → `DSI_PROMPTS_DB` env →
 * `prompts.dbPath` from settings.yaml (~/ expanded; a trailing separator
 * means the value is a directory and the default filename lands inside) →
 * sibling of DSI_CONFIG_PATH (`~/.dsi/prompts.sqlite`).
 */
export function resolvePromptsDbPath(path?: string): string {
	if (path !== undefined) return path;
	const env = process.env[PROMPTS_DB_ENV];
	if (env !== undefined) return env;
	const configured = readPromptsConfig().dbPath;
	if (configured !== null) {
		const p = expandHome(configured);
		// A trailing separator marks a DIRECTORY — the library file lands
		// inside it under the default name (prompts.dbPath: ~/library/).
		return p.endsWith('/') ? join(p, PROMPTS_DB_FILENAME) : p;
	}
	return join(dirname(DSI_CONFIG_PATH), PROMPTS_DB_FILENAME);
}

/** Degrade-contract logger — server has no logger module (a2a precedent
 *  swallows silently); this feature's contract says failures LOG and
 *  return empty/false, so a prefixed console.warn is the honest floor. */
export function warn(msg: string, e: unknown): void {
	console.warn(`[prompts-db] ${msg}`, e instanceof Error ? e.message : e);
}
// ── Types ──

export interface PromptRecord {
	id: number;
	/** One-line display handle; NULL for single-line prompts (ADR D3). */
	label: string | null;
	/** The prompt as sent; may be multiline (ADR D3). */
	text: string;
	use_count: number;
	/** Macro flag (schema v3): 1 = macro prompt, 0 = ordinary. */
	macro: number;
	last_used_at: string;
	created_at: string;
	/** Space-joined lowercase tag words (schema v4); '' = untagged
	 *  (The Prompt Tags ADR, 2026-09-14, D1). */
	tags: string;
}


const SCHEMA = `
CREATE TABLE IF NOT EXISTS prompts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT,
  text         TEXT NOT NULL,
  use_count    INTEGER NOT NULL DEFAULT 1,
  macro        INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  tags         TEXT NOT NULL DEFAULT '',
  UNIQUE(text)
);
CREATE INDEX IF NOT EXISTS idx_prompts_text ON prompts(text);
CREATE INDEX IF NOT EXISTS idx_prompts_prune
  ON prompts(use_count, last_used_at);
`;

// idx_prompts_tags deliberately NOT in SCHEMA (the idx_prompts_label
// reason): exec(SCHEMA) precedes migrate(), and a pre-v4 table lacks a
// tags column — the CREATE INDEX would throw and the open would degrade.
// The v4 migration step owns it.

/** Hard row cap — overflow prunes oldest one-use rows (ADR D13). */
export const MAX_ROWS = 5000;

/** FTS5 external-content trigram index + sync triggers (schema v2, ADR v1.2
 *  F3). Applied by migrate(), NOT in SCHEMA: `CREATE VIRTUAL TABLE` has no
 *  IF NOT EXISTS and SCHEMA is exec'd on every open — migrate re-enters via
 *  DROP IF EXISTS, safe because external content makes the index disposable
 *  (rebuildable at any time from the source-of-truth table). */
const FTS_SCHEMA = `
CREATE VIRTUAL TABLE prompts_fts USING fts5(
  label, text,
  content='prompts', content_rowid='id',
  tokenize='trigram'
);
CREATE TRIGGER prompts_ai AFTER INSERT ON prompts BEGIN
  INSERT INTO prompts_fts(rowid, label, text) VALUES (new.id, new.label, new.text);
END;
CREATE TRIGGER prompts_ad AFTER DELETE ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, label, text)
  VALUES ('delete', old.id, old.label, old.text);
END;
CREATE TRIGGER prompts_au AFTER UPDATE OF label, text ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, label, text)
  VALUES ('delete', old.id, old.label, old.text);
  INSERT INTO prompts_fts(rowid, label, text) VALUES (new.id, new.label, new.text);
END;
`;

/** Schema version tracked via PRAGMA user_version (ADR D11).
 *  v0: original table — text/use_count/last_used_at only (label-less).
 *  v1: adds label, created_at, prune index, UNIQUE(text) upsert semantics.
 *  v2: adds prompts_fts trigram index + sync triggers (ADR v1.2 F3).
 *  v3: adds the macro flag column (0 = ordinary, 1 = macro).
 *  v4: appends the tags column (The Prompt Tags ADR, 2026-09-14, D2) —
 *      tags have no column-order constraint, so migration is the cheap
 *      ALTER + filter index, never the v3 prompts_new rebuild. */
const SCHEMA_VERSION = 4;
// ── Connection management (a2a singleton idiom) ──

let defaultDb: DatabaseSync | null = null;

/**
 * Open (creating if needed) the library DB and ensure schema. Idempotent:
 * DDL re-runs safely, migrate is version-gated. An explicit `path` always
 * returns a FRESH handle (test/tmp isolation); the no-arg form memoizes
 * one default handle per process — routes and the finder share it.
 * Never throws: on failure logs and returns null — the feature degrades
 * silently (no strip, no recording; the app is otherwise fine).
 */
export function openPromptsDb(path?: string): DatabaseSync | null {
	if (path === undefined && defaultDb !== null) {
		try {
			defaultDb.prepare('SELECT 1').get();
			return defaultDb;
		} catch {
			try {
				defaultDb.close();
			} catch {
				/* already dead */
			}
			defaultDb = null;
		}
	}
	const file = resolvePromptsDbPath(path);
	try {
		// DatabaseSync creates the file but not its directory (OCI/a2a precedent).
		mkdirSync(dirname(file), { recursive: true });
		const db = new DatabaseSync(file);
		// Concurrent-access hardening (RCA 2026-09-15, PromptManagerEdit 409):
		// another process holding the library (e.g. a DB browser's idle
		// connection) made every write fail fast with SQLITE_BUSY; updatePrompt
		// swallowed it into null and the PATCH route reported a misleading 409
		// 'Not found or conflict'. busy_timeout waits out the lock; WAL lets
		// readers and the writer coexist.
		db.exec('PRAGMA busy_timeout = 3000');
		db.exec('PRAGMA journal_mode = WAL');
		db.exec(SCHEMA);
		migrate(db);
		if (path === undefined) defaultDb = db;
		return db;
	} catch (e) {
		warn(`Failed to open ${file}:`, e);
		return null;
	}
}

/**
 * Idempotent in-place migration (ADR D11). CREATE TABLE IF NOT EXISTS does
 * not evolve an existing table — a prompts.sqlite created by the pre-label
 * build lacks the label/created_at columns, and every query against them
 * fails. Bump-then-alter: read PRAGMA user_version, add missing columns +
 * indexes, set new version. Failure logs and leaves user_version where it
 * is — the DB still opens, prefix/contains LIKE search keeps working, and
 * the next open retries.
 */
function migrate(db: DatabaseSync): void {
	const current = (
		db.prepare('PRAGMA user_version').get() as { user_version: number }
	).user_version;
	if (current >= SCHEMA_VERSION) return;
	try {
		if (current < 1) {
			const cols = (
				db.prepare('PRAGMA table_info(prompts)').all() as { name: string }[]
			).map((c) => c.name);
			if (!cols.includes('label')) {
				db.exec('ALTER TABLE prompts ADD COLUMN label TEXT');
			}
			if (!cols.includes('created_at')) {
				// SQLite ALTER ADD COLUMN rejects non-constant defaults (datetime('now')).
				// Add nullable, backfill, then it behaves like the fresh-schema column.
				db.exec('ALTER TABLE prompts ADD COLUMN created_at TEXT');
				db.exec(
					"UPDATE prompts SET created_at = datetime('now') WHERE created_at IS NULL"
				);
			}
			// UNIQUE(text) cannot be added by ALTER on an existing table; enforce
			// upsert semantics via a unique index instead (same conflict target).
			db.exec(
				'CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_text_unique ON prompts(text)'
			);
			db.exec(
				"UPDATE prompts SET use_count = MAX(use_count, 1) WHERE use_count < 1"
			);
		}
		if (current < 2) {
			// v2 (ADR v1.2 F3): FTS5 trigram shadow index. Re-entrant — DROP first
			// so a half-finished earlier attempt (vtable created, backfill failed)
			// rebuilds cleanly. External content makes the index disposable.
			db.exec('DROP TABLE IF EXISTS prompts_fts');
			db.exec('DROP TRIGGER IF EXISTS prompts_ai');
			db.exec('DROP TRIGGER IF EXISTS prompts_ad');
			db.exec('DROP TRIGGER IF EXISTS prompts_au');
			db.exec(FTS_SCHEMA);
			db.exec(
				'INSERT INTO prompts_fts(rowid, label, text) SELECT id, label, text FROM prompts'
			);
		}
		if (current < 3) {
			// v3: macro flag in the pinned column order (id, label, text,
			// use_count, macro, last_used_at, created_at). ALTER ADD COLUMN can
			// only append, so a table lacking macro OR carrying it out of order
			// is rebuilt: create the new shape, copy by name, swap, recreate
			// indexes and the FTS shadow (external content — disposable).
			const want7 = ['id', 'label', 'text', 'use_count', 'macro', 'last_used_at', 'created_at'];
			let cols = (
				db.prepare('PRAGMA table_info(prompts)').all() as { name: string }[]
			).map((c) => c.name);
			// The pinned-order check covers the SEVEN v3 columns; a fresh SCHEMA
			// table already carries v4's appended tags, so the comparison extends
			// by one ONLY when the table already has it (a pre-v3 file rebuilds to
			// the 7-col shape and the v4 step appends tags below).
			const want = cols.includes('tags') ? [...want7, 'tags'] : want7;
			if (!cols.includes('macro')) {
				// Pre-v3 table (or a v2 file): append first so the rebuild's SELECT
				// can read it; the rebuild below fixes the position.
				db.exec('ALTER TABLE prompts ADD COLUMN macro INTEGER NOT NULL DEFAULT 0');
				cols = (
					db.prepare('PRAGMA table_info(prompts)').all() as { name: string }[]
				).map((c) => c.name);
			}
			if (JSON.stringify(cols) !== JSON.stringify(want)) {
				db.exec('DROP TABLE IF EXISTS prompts_fts');
				db.exec('DROP TRIGGER IF EXISTS prompts_ai');
				db.exec('DROP TRIGGER IF EXISTS prompts_ad');
				db.exec('DROP TRIGGER IF EXISTS prompts_au');
				db.exec('DROP INDEX IF EXISTS idx_prompts_text');
				db.exec('DROP INDEX IF EXISTS idx_prompts_text_unique');
				db.exec('DROP INDEX IF EXISTS idx_prompts_prune');
				db.exec('DROP INDEX IF EXISTS idx_prompts_label');
				db.exec(`CREATE TABLE prompts_new (
					id           INTEGER PRIMARY KEY AUTOINCREMENT,
					label        TEXT,
					text         TEXT NOT NULL,
					use_count    INTEGER NOT NULL DEFAULT 1,
					macro        INTEGER NOT NULL DEFAULT 0,
					last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
					created_at   TEXT NOT NULL DEFAULT (datetime('now')),
					UNIQUE(text)
				)`);
				db.exec(`INSERT INTO prompts_new (id, label, text, use_count, macro, last_used_at, created_at)
					SELECT id, label, text, use_count, COALESCE(macro, 0), last_used_at,
						COALESCE(created_at, datetime('now'))
					FROM prompts`);
				db.exec('DROP TABLE prompts');
				db.exec('ALTER TABLE prompts_new RENAME TO prompts');
				db.exec('CREATE INDEX IF NOT EXISTS idx_prompts_text ON prompts(text)');
				db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_text_unique ON prompts(text)');
				db.exec('CREATE INDEX IF NOT EXISTS idx_prompts_prune ON prompts(use_count, last_used_at)');
				db.exec(FTS_SCHEMA);
				db.exec(
					'INSERT INTO prompts_fts(rowid, label, text) SELECT id, label, text FROM prompts'
				);
			}
		}
		if (current < 4) {
			// v4 (The Prompt Tags ADR, 2026-09-14, D2): append the tags column —
			// no order constraint, so the cheap ALTER, never the prompts_new
			// rebuild (which would needlessly drop/recreate the FTS shadow).
			// Backfill is empty by design: no row gets a guessed tag.
			const cols = (
				db.prepare('PRAGMA table_info(prompts)').all() as { name: string }[]
			).map((c) => c.name);
			if (!cols.includes('tags')) {
				db.exec("ALTER TABLE prompts ADD COLUMN tags TEXT NOT NULL DEFAULT ''");
			}
			db.exec('CREATE INDEX IF NOT EXISTS idx_prompts_tags ON prompts(tags)');
		}
		// idx_prompts_label cannot live in SCHEMA: a v0 table lacks `label`, and
		// exec(SCHEMA) runs before migrate() — the CREATE INDEX would throw and
		// openPromptsDb would degrade, so v0 DBs never reached this migration.
		db.exec(
			'CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_label ON prompts(label) WHERE label IS NOT NULL'
		);
		db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
	} catch (e) {
		warn('migration failed:', e);
	}
}

/** Close and drop the cached default connection (test teardown). */
export function closePromptsDb(): void {
	if (defaultDb) {
		try {
			defaultDb.close();
		} catch {
			/* ignore */
		}
		defaultDb = null;
	}
}

/** Test-only alias — the a2a `__resetA2aDbCache` name, for seam parity. */
export function __resetPromptsDbCache(): void {
	closePromptsDb();
}


// ── Shared row shape + macro filter (used by search, CRUD, and the fuzzy
//    re-rank; homed here so similarity.ts needs no back-import to the
//    shell — ADR-0022 W2 seam note) ──

/** The canonical projection of a prompts row (every query selects this). */
export const SELECT_COLS = 'id, label, text, use_count, macro, last_used_at, created_at, tags';

/** SQL fragment filtering the macro flag — empty when unfiltered (the
 *  finder shows macros and ordinary prompts alike; the manager filters). */
export function macroCond(macro: 0 | 1 | undefined): string {
	return macro === undefined ? '' : ` AND macro = ${macro}`;
}
