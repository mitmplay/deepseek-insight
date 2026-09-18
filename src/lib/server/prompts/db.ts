/**
 * prompts-db (2026-08-28) — the Shelf: one global store of operator prompt
 * habits behind the DSI composer's `?` finder. Every admitted ordinary
 * send is recorded (first send creates the row, later sends increment);
 * search matches label/text prefix (legacy) or contains/fuzzy (`?`,
 * tier waterfall); ranking is use_count DESC, last_used_at DESC. Table is
 * capped at 5,000 rows — overflow prunes the oldest use_count=1 rows
 * (LRU of one-offs; multi-use rows are never pruned). A disposable FTS5
 * trigram index (schema v2) shadows the table for `?` search; any FTS
 * failure degrades to LIKE — never blocks open, never throws to a route.
 *
 * Spec: dev/specs/2026-08-28 - DSI Suggest Strip (PRD Module Map
 *      "prompts-db"; Tasks 1.1). Reference: OCI src/lib/server/prompts/db.ts
 *      (behavioral reference — semantics ported, names/seams DSI-native).
 *
 * Storage: node:sqlite DatabaseSync, zero new npm deps. File lives at
 * `~/.dsi/prompts.sqlite` by default (DSI_CONFIG_PATH sibling, same trust
 * boundary as a2a.sqlite — operator-copied 2026-08-28 with 30 seeded
 * rows); `prompts.dbPath` in settings.yaml moves it (~/ expanded), and
 * `DSI_PROMPTS_DB` env override is the test seam (each
 * node-env-globed test file points it at a tmp path before first open).
 *
 * Module boundary (PRD communication map): this module imports the
 * config layer only (for the directory) — never dsh-connection, never
 * dsh-rpc (D10), never the client suggest service (fuzzy math is
 * server-local so the client never crosses into $lib/server).
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DSI_CONFIG_PATH, readPromptsConfig } from '$lib/server/insight-config.js';
import { joinTagWords, parseTagWords } from '$lib/server/prompts/tags.js';

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
function warn(msg: string, e: unknown): void {
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

// ── Schema (ADR D9; OCI schema v2 — identical shape, seeded file opens as-is) ──

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
const MAX_ROWS = 5000;

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

// ── Queries ──

const SELECT_COLS = 'id, label, text, use_count, macro, last_used_at, created_at, tags';

/** Find a prompt by exact (trimmed) text. Null on miss/failure. */
export function findPromptByText(text: string): PromptRecord | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	const db = openPromptsDb();
	if (!db) return null;
	try {
		const row = db
			.prepare(`SELECT ${SELECT_COLS} FROM prompts WHERE text = ?`)
			.get(trimmed) as unknown as PromptRecord | undefined;
		return row ?? null;
	} catch (e) {
		warn('findPromptByText failed:', e);
		return null;
	}
}

/**
 * Record a sent prompt (ADR D5/D15): insert on first send, increment
 * use_count + refresh last_used_at afterwards. Enforces the row cap.
 * Returns the updated record, or null on failure (DB unavailable/empty text).
 */
export function recordPromptUse(text: string): PromptRecord | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	const db = openPromptsDb();
	if (!db) return null;

	try {
		db.prepare(
			`INSERT INTO prompts (label, text, use_count, last_used_at, created_at)
       VALUES (NULL, ?, 1, datetime('now'), datetime('now'))
       ON CONFLICT(text) DO UPDATE SET
         use_count = use_count + 1,
         last_used_at = datetime('now')`
		).run(trimmed);
		pruneIfNeeded(db);
		const row = db
			.prepare(`SELECT ${SELECT_COLS} FROM prompts WHERE text = ?`)
			.get(trimmed) as unknown as PromptRecord | undefined;
		return row ?? null;
	} catch (e) {
		warn('recordPromptUse failed:', e);
		return null;
	}
}

/**
 * Count-only use recording (The Prompt Tags ADR, 2026-09-14, D7): bump
 * use_count + refresh last_used_at for an EXISTING row; unknown text
 * returns { counted: false } and inserts NOTHING — the wire's only path
 * to a row is an operator save. Null on failure (DB unavailable/empty text).
 */
export function countPromptUse(
	text: string
): { counted: true; record: PromptRecord } | { counted: false } | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	const db = openPromptsDb();
	if (!db) return null;
	try {
		const res = db
			.prepare(
				`UPDATE prompts
       SET use_count = use_count + 1, last_used_at = datetime('now')
       WHERE text = ?`
			)
			.run(trimmed);
		if (res.changes === 0) return { counted: false };
		const row = db
			.prepare(`SELECT ${SELECT_COLS} FROM prompts WHERE text = ?`)
			.get(trimmed) as unknown as PromptRecord | undefined;
		return row ? { counted: true, record: row } : null;
	} catch (e) {
		warn('countPromptUse failed:', e);
		return null;
	}
}

/**
 * Cap enforcement (ADR D13): if rows > MAX_ROWS, delete the oldest
 * use_count=1 rows until at cap. Multi-use prompts are never pruned.
 */
function pruneIfNeeded(db: DatabaseSync): void {
	try {
		const overflow =
			(
				db.prepare('SELECT COUNT(*) AS n FROM prompts').get() as { n: number }
			).n - MAX_ROWS;
		if (overflow <= 0) return;
		db.prepare(
			`DELETE FROM prompts
       WHERE id IN (
         SELECT id FROM prompts
         WHERE use_count <= 1
         ORDER BY last_used_at ASC, id ASC
         LIMIT ?
       )`
		).run(overflow);
	} catch (e) {
		warn('prune failed:', e);
	}
}

/**
 * Search prompts. Ranked by use_count DESC, last_used_at DESC.
 *
 * `?` contains/fuzzy mode (ADR v1.2 F2, schema v2): opts.mode ===
 * 'contains' dispatches tiered search —
 *   tier 0: key < 3 chars → LIKE '%q%' table scan (trigram index unusable)
 *   tier 1: ≥ 3 chars → FTS MATCH '"key"' (index-accelerated contains)
 *   tier 2: tier-1 empty AND key ≥ FUZZY_MIN_LEN(4) → per-term best-line
 *           Dice, min-combine (Semicolon Search S3): union of per-term
 *           trigram pools (bm25 cap 50, union cap 100) re-ranked by
 *           min-over-terms of max-over-lines score (label = first line;
 *           word-aware — a term scores against each word of a line as
 *           well as the whole line), floored at 0.3 per term.
 * Tier 1 always fully outranks tier 2 — tiers never mix in one response.
 * Default (no mode) keeps the OCI prefix contract: label OR text prefix,
 * case-insensitive — DSI drops the ghost-only single-line filter (the
 * ghost is out, ADR §6).
 */
export function searchPrompts(
	prefix: string,
	limit = 5,
	opts?: { mode?: 'prefix' | 'contains'; macro?: 0 | 1 }
): PromptRecord[] {
	const db = openPromptsDb();
	if (!db) return [];

	const trimmed = prefix.trim();
	if (!trimmed) return [];

	try {
		if (opts?.mode === 'contains') return searchContains(db, trimmed, limit, opts.macro);
		return db
			.prepare(
				`SELECT ${SELECT_COLS} FROM prompts
         WHERE (label LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\')${macroCond(opts?.macro)}
         ORDER BY use_count DESC, last_used_at DESC
         LIMIT ?`
			)
			.all(`${escLike(trimmed)}%`, `${escLike(trimmed)}%`, limit) as unknown as PromptRecord[];
	} catch (e) {
		warn('searchPrompts failed:', e);
		return [];
	}
}

/** SQL fragment filtering the macro flag — empty when unfiltered (the
 *  value is a server-internal 0|1, never user text, so inlining is safe). */
function macroCond(macro: 0 | 1 | undefined): string {
	return macro === undefined ? '' : ` AND macro = ${macro}`;
}

/** Escape LIKE wildcards in user input so the prefix matches literally. */
function escLike(s: string): string {
	return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ── `?` tiered search (ADR v1.2 F2; Semicolon Search S1–S3) ──

/** Trigram index needs ≥3-char keys; below this tier 0 falls back to LIKE. */
const CONTAINS_MIN_FTS = 3;

/** Candidate-pool caps: per-term pool (bm25) and the union budget (S3). */
const FUZZY_CANDIDATE_LIMIT = 50;
const FUZZY_UNION_LIMIT = 100;

/** Dice similarity floor for tier-2 inclusion — PER TERM (min-combine,
 *  S3): a row is only as strong as its weakest keyword. Below = noise; the
 *  ADR word-share decoy scores 0.174 — excluded. */
const FUZZY_DICE_FLOOR = 0.3;

/** Minimum key length for tier-2 fuzzy (single-term): below, a tier-1
 *  miss is an honest miss (OCI v1.2 contract; PRD "fuzzy Dice ≥4 chars"). */
export const FUZZY_MIN_LEN = 4;

// ── Multi-keyword query parsing (ADR 2026-08-19 Semicolon Search S1) ──

/** Query term as carried through the tiers: display + match forms. */
export interface QueryTerm {
	/** Trimmed, case-preserved fragment for display/echo comparisons. */
	raw: string;
	/** Lowercased form for matching (trigram FTS is ASCII case-folding). */
	lower: string;
}

/**
 * Split a `?`-search key into keyword terms (ADR S1): split on `;` and
 * whitespace, trim, drop empties, dedupe (case-insensitive, first spelling
 * wins). `load;skill;feature-spec` → [load, skill, feature-spec];
 * `load;;skill;` → [load, skill]; single term → array of one — the caller
 * decides which path runs. Empty/blank key → []. Pure; exported for tests.
 */
export function splitQueryTerms(key: string): QueryTerm[] {
	const seen = new Set<string>();
	const terms: QueryTerm[] = [];
	for (const frag of key.split(/[;\s]+/)) {
		const raw = frag.trim();
		if (!raw) continue;
		const lower = raw.toLowerCase();
		if (seen.has(lower)) continue;
		seen.add(lower);
		terms.push({ raw, lower });
	}
	return terms;
}

/** Build an FTS5 phrase string from one term: `"` doubled per FTS5
 *  phrase quoting. */
function ftsPhrase(term: string): string {
	return `"${term.replace(/"/g, '""')}"`;
}

/**
 * Tier dispatch for `?` queries: tier 0 LIKE / tier 1 FTS contains /
 * tier 2 fuzzy. Any FTS failure degrades to tier-0 LIKE — search never
 * throws (callers get an empty array or LIKE results, per ADR F3).
 *
 *  Multi-keyword (S1+S2): a `;`/whitespace-split key with ≥2 terms takes
 *  the AND path — every keyword must appear somewhere in the row (each
 *  anywhere, order-free); more keywords narrow the result. Tier 1 runs an
 *  AND-of-phrases FTS MATCH on indexable (≥3 char) terms with sub-3-char
 *  terms re-verified by LIKE post-filter over the FTS row set; the
 *  self-echo row (a previously recorded query whose text starts with the
 *  key as sent) is suppressed when it is the ONLY hit; tier 2 is per-term
 *  best-line Dice, min-combine (S3). FTS failure degrades to LIKE-AND
 *  across ALL terms (AND is absolute in both tiers). A single term keeps
 *  the exact v1.2 path.
 */
function searchContains(
	db: DatabaseSync,
	key: string,
	limit: number,
	macro: 0 | 1 | undefined
): PromptRecord[] {
	const terms = splitQueryTerms(key);
	if (terms.length > 1) return searchContainsMulti(db, key, terms, limit, macro);
	const single = terms.length === 1 ? terms[0].raw : key;
	if (single.length < CONTAINS_MIN_FTS) {
		return containsLike(db, single, limit, macro);
	}
	try {
		const contains = ftsContains(db, single, limit, macro);
		if (contains.length > 0) return contains;
		if (single.length < FUZZY_MIN_LEN) return [];
		return fuzzyReRank(db, terms, limit, macro);
	} catch {
		// FTS unavailable/corrupted → degrade to LIKE (contains), never throw
		return containsLike(db, single, limit, macro);
	}
}

/** Echo guard: the query row itself — text starts with the `?`-key as the
 *  operator sent it (queries ARE recorded when sent, so the query's own
 *  row can be the only tier-1 hit; G3). Case-insensitive: LIKE matching
 *  is case-insensitive for ASCII, and trigram FTS is ASCII case-folding —
 *  the echo row can reach tier 1 through a case variant too. */
function isQueryEcho(text: string, keyAsSent: string): boolean {
	return text.toLowerCase().startsWith(keyAsSent.toLowerCase());
}

/**
 * Multi-keyword `?` search (S1+S2): AND semantics.
 * Tier 1: FTS MATCH '"t1" AND "t2" AND …' over indexable terms (≥3 chars);
 * sub-3-char terms can't use the trigram index, so they're enforced via
 * post-filter LIKE over the FTS row set (AND preserved). The self-echo
 * row is dropped when it's the only tier-1 hit. Tier 2 is per-term
 * best-line Dice, min-combine (S3) — unified with the single-term path.
 * Any FTS failure degrades to LIKE-AND across all terms — never throws.
 */
function searchContainsMulti(
	db: DatabaseSync,
	key: string,
	terms: QueryTerm[],
	limit: number,
	macro: 0 | 1 | undefined
): PromptRecord[] {
	const indexable = terms.filter((t) => t.lower.length >= CONTAINS_MIN_FTS);
	try {
		let rows: PromptRecord[];
		if (indexable.length > 0) {
			rows = ftsAndContains(db, indexable, limit, macro);
			// Sub-3-char terms: trigram index unusable — enforce via case-
			// insensitive contains over the FTS row set (AND absolute).
			const shortTerms = terms.filter((t) => t.lower.length < CONTAINS_MIN_FTS);
			if (shortTerms.length > 0) {
				rows = rows.filter((row) =>
					shortTerms.every((t) =>
						`${row.label ?? ''}\n${row.text}`.toLowerCase().includes(t.lower)
					)
				);
			}
		} else {
			// No indexable term at all (e.g. `ab;cd`) — straight to LIKE-AND.
			rows = likeAndContains(db, terms, limit, macro);
		}
		// Echo guard (S2/G3): when the ONLY hit is the recorded query row
		// itself, drop it — an honest miss, not a self-serve echo.
		if (rows.length === 1 && isQueryEcho(rows[0].text, key)) {
			rows = [];
		}
		if (rows.length > 0) return rows;
		if (key.length < FUZZY_MIN_LEN) return [];
		const fuzzy = fuzzyReRank(db, terms, limit, macro);
		// Echo guard holds across the tier-2 handoff: a fuzzy-recovered echo
		// row as the sole result is still a self-serve echo (G3).
		if (fuzzy.length === 1 && isQueryEcho(fuzzy[0].text, key)) return [];
		return fuzzy;
	} catch {
		// FTS unavailable/corrupted → LIKE-AND across all terms, never throw
		return likeAndContains(db, terms, limit, macro);
	}
}

/** Tier 1 (multi-term) — AND-of-phrases MATCH: every keyword somewhere,
 *  order-free, index-accelerated. Phrases quote-escaped via ftsPhrase. */
function ftsAndContains(
	db: DatabaseSync,
	terms: QueryTerm[],
	limit: number,
	macro: 0 | 1 | undefined
): PromptRecord[] {
	const expr = terms.map((t) => ftsPhrase(t.lower)).join(' AND ');
	return db
		.prepare(
			`SELECT ${SELECT_COLS} FROM prompts
       WHERE id IN (SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH ?)${macroCond(macro)}
       ORDER BY use_count DESC, last_used_at DESC
       LIMIT ?`
		)
		.all(expr, limit) as unknown as PromptRecord[];
}

/** LIKE-AND across all terms (multi-term tier-0 and FTS degrade path):
 *  case-insensitive contains for EVERY term in label-or-text. Trigram
 *  FTS is ASCII case-folding — toLowerCase() keeps LIKE equivalent. */
function likeAndContains(
	db: DatabaseSync,
	terms: QueryTerm[],
	limit: number,
	macro: 0 | 1 | undefined
): PromptRecord[] {
	const conds = terms.map(() => "(label LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\')");
	const params: string[] = [];
	for (const t of terms) {
		const like = `%${escLike(t.lower)}%`;
		params.push(like, like);
	}
	return db
		.prepare(
			`SELECT ${SELECT_COLS} FROM prompts
       WHERE ${conds.join(' AND ')}${macroCond(macro)}
       ORDER BY use_count DESC, last_used_at DESC
       LIMIT ?`
		)
		.all(...params, limit) as unknown as PromptRecord[];
}

/** Tier 1 — index-accelerated contains via trigram phrase MATCH. */
function ftsContains(
	db: DatabaseSync,
	key: string,
	limit: number,
	macro: 0 | 1 | undefined
): PromptRecord[] {
	const expr = ftsPhrase(key.toLowerCase());
	if (!key) return containsLike(db, key, limit, macro);
	return db
		.prepare(
			`SELECT ${SELECT_COLS} FROM prompts
       WHERE id IN (SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH ?)${macroCond(macro)}
       ORDER BY use_count DESC, last_used_at DESC
       LIMIT ?`
		)
		.all(expr, limit) as unknown as PromptRecord[];
}

/** Tier 0 — LIKE table scan (short keys; FTS degrade path shares it). */
function containsLike(
	db: DatabaseSync,
	key: string,
	limit: number,
	macro: 0 | 1 | undefined
): PromptRecord[] {
	const like = `%${escLike(key)}%`;
	return db
		.prepare(
			`SELECT ${SELECT_COLS} FROM prompts
       WHERE (label LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\')${macroCond(macro)}
       ORDER BY use_count DESC, last_used_at DESC
       LIMIT ?`
		)
		.all(like, like, limit) as unknown as PromptRecord[];
}

// ── Fuzzy scoring (server-local: db.ts may import insight-config only,
//    so the client suggest service's math lives here too — S3 semantics) ──

/** Dice coefficient over character trigrams (case handled by callers). */
export function diceSimilarity(a: string, b: string): number {
	const grams = new Map<string, number>();
	for (let i = 0; i + 3 <= a.length; i++) {
		const g = a.slice(i, 3 + i);
		grams.set(g, (grams.get(g) ?? 0) + 1);
	}
	if (grams.size === 0) return 0;
	let bCount = 0;
	let shared = 0;
	for (let i = 0; i + 3 <= b.length; i++) {
		bCount++;
		const g = b.slice(i, 3 + i);
		const have = grams.get(g) ?? 0;
		if (have > 0) {
			shared++;
			if (have === 1) grams.delete(g);
			else grams.set(g, have - 1);
		}
	}
	if (bCount === 0) return 0;
	const aCount = a.length - 2;
	return (2 * shared) / (aCount + bCount);
}

/**
 * Word-level similarity: max of Dice and normalized edit distance — Dice is
 * meaningless for words shorter than 3 trigrams/chars, edit covers them
 * ("lod" vs "load": Dice 0, edit 0.75 → 0.75). Exported for tests.
 */
export function wordSimilarity(a: string, b: string): number {
	const edit = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
	return Math.max(diceSimilarity(a, b), edit);
}

/** Wagner–Fischer edit distance (two-row DP), case handled by callers. */
function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(
				prev[j] + 1,
				cur[j - 1] + 1,
				prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
		}
		prev = cur;
	}
	return prev[b.length];
}

/** Lines a row offers to line-level Dice (S3): label counts as the FIRST
 *  line — the user-chosen handle deserves line parity with text lines. */
function rowLines(row: PromptRecord): string[] {
	return row.label !== null
		? [row.label, ...row.text.split('\n')]
		: row.text.split('\n');
}

/** Best-line score for ONE term (S3): max over the row's lines, where a
 *  line's score is the best of whole-line Dice and word-level similarity
 *  over the line's words (max of Dice and normalized edit distance — Dice
 *  is meaningless for words shorter than 3 trigrams, edit covers them:
 *  typo'd "lod" vs "load" clears the floor at word level while line-level
 *  trigram dilution would sink it). The word-aware allowance is what keeps
 *  typo'd short terms reachable under min-combine as part of a multi-term
 *  key. Localizing to the best line kills the body tax: a 400-char body
 *  diluting full-text Dice can no longer sink a term that matches its own
 *  line cleanly. */
function termLineScore(term: string, row: PromptRecord): number {
	let best = 0;
	for (const line of rowLines(row)) {
		const l = line.toLowerCase();
		if (l.includes(term)) {
			best = 1; // exact contains on a line — the strongest line signal
			break;
		}
		let lineScore = diceSimilarity(term, l);
		for (const word of l.split(/\s+/)) {
			if (!word) continue;
			lineScore = Math.max(lineScore, wordSimilarity(term, word));
		}
		best = Math.max(best, lineScore);
	}
	return best;
}

/** FTS5 trigram set for a single term (S3): grams of the lowercased term
 *  only — never extracted across separators, so no junk grams bridge
 *  `;`-split keywords. Deduped; null for <3-char terms (no grams). */
function termTrigramExpr(term: string): string | null {
	const k = term.toLowerCase();
	const grams: string[] = [];
	for (let i = 0; i + 3 <= k.length && grams.length < 64; i++) {
		const g = k.slice(i, 3 + i);
		if (!grams.includes(g)) grams.push(g);
	}
	return grams.length ? grams.map((g) => `"${g}"`).join(' OR ') : null;
}

/** Tier 2 — per-term best-line Dice, min-combine (S3, Semicolon Search).
 *  Candidate pool: per-term trigram OR + bm25 cap 50, UNION of per-term
 *  pools capped 100 — a row matching ANY term fuzzily enters the pool;
 *  per-term scoring then enforces the AND. Row score = MIN over terms of
 *  (max Dice over the row's lines, label counts as first line); any term
 *  under the 0.3 floor excludes the row entirely. Ordering: score DESC,
 *  use_count DESC, last_used_at DESC. Never mixes with tier 1 (only runs
 *  when tier 1 returned empty). */
function fuzzyReRank(
	db: DatabaseSync,
	terms: QueryTerm[],
	limit: number,
	macro: 0 | 1 | undefined
): PromptRecord[] {
	// Union of per-term pools, preserving row identity (map de-dupes).
	const pool = new Map<number, PromptRecord>();
	for (const term of terms) {
		if (term.lower.length < CONTAINS_MIN_FTS) continue; // <3 chars: no trigrams
		const expr = termTrigramExpr(term.lower);
		if (!expr) continue;
		try {
			const rows = db
				.prepare(
					`SELECT ${SELECT_COLS} FROM prompts
           WHERE id IN (
             SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH ?
             ORDER BY bm25(prompts_fts) LIMIT ${FUZZY_CANDIDATE_LIMIT}
           )${macroCond(macro)}`
				)
				.all(expr) as unknown as PromptRecord[];
			for (const r of rows) {
				if (pool.size >= FUZZY_UNION_LIMIT) break;
				if (!pool.has(r.id)) pool.set(r.id, r);
			}
		} catch {
			// one term's pool failing must not kill the others' pools
		}
	}
	if (pool.size === 0) return [];
	const scored = [...pool.values()]
		.map((row) => {
			const score = terms.reduce((min, t) => Math.min(min, termLineScore(t.lower, row)), 1);
			return { row, score };
		})
		.filter((s) => s.score >= FUZZY_DICE_FLOOR)
		.sort(
			(a, b) =>
				b.score - a.score ||
				b.row.use_count - a.row.use_count ||
				(b.row.last_used_at < a.row.last_used_at
					? 1
					: b.row.last_used_at > a.row.last_used_at
						? -1
						: 0)
		);
	return scored.slice(0, limit).map((s) => s.row);
}

/**
 * Rename a prompt's label (ADR D3). Label is the one-line handle used for
 * matching and display; passing null clears it. Fails (returns false) if
 * another prompt already claims the label (unique partial index).
 */
export function renamePromptLabel(id: number, label: string | null): boolean {
	const db = openPromptsDb();
	if (!db) return false;
	try {
		const clean = label === null ? null : label.trim().slice(0, 60) || null;
		const res = db.prepare('UPDATE prompts SET label = ? WHERE id = ?').run(clean, id);
		return res.changes > 0;
	} catch (e) {
		warn('renamePromptLabel failed:', e);
		return false;
	}
}

/** Delete a prompt row. Returns true when a row was removed. */
export function deletePrompt(id: number): boolean {
	const db = openPromptsDb();
	if (!db) return false;
	try {
		const res = db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
		return res.changes > 0;
	} catch (e) {
		warn('deletePrompt failed:', e);
		return false;
	}
}

// ── Manager queries (ADR v1.1 E4) ──

/** Sort param → ORDER BY clause (col + direction). */
const SORT_MAP: Record<string, { col: string; asc: string; desc: string }> = {
	uses: { col: 'use_count', asc: 'use_count ASC', desc: 'use_count DESC' },
	last_used: {
		col: 'last_used_at',
		asc: 'last_used_at ASC',
		desc: 'last_used_at DESC'
	},
	created: { col: 'created_at', asc: 'created_at ASC', desc: 'created_at DESC' },
	// Sorts the visible "Label / Text" column by its display handle
	// (label when present, else text).
	display: {
		col: 'COALESCE(label, text)',
		asc: 'COALESCE(label, text) ASC',
		desc: 'COALESCE(label, text) DESC'
	}
};

/**
 * List prompts for the manager (ADR E4). Supports optional prefix filter,
 *  sort, and offset paging. Returns rows + total count (for cap-footer UX).
 */
export function listPrompts(opts: {
	q?: string;
	/** Active tag filter words (The Prompt Tags ADR, 2026-09-14, D4):
	 *  AND semantics via a padded LIKE per word — `' ' || tags || ' '`
	 *  LIKE '% word %' — so `git` never matches `github` and underscore
	 *  is literal. Words are grammar-validated by the route first, so the
	 *  LIKE payload cannot carry wildcards. */
	tags?: string[];
	limit?: number;
	offset?: number;
	sort?: string;
	dir?: 'asc' | 'desc';
}): { rows: PromptRecord[]; total: number } {
	const db = openPromptsDb();
	if (!db) return { rows: [], total: 0 };

	const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
	const offset = Math.max(opts.offset ?? 0, 0);
	const sortKey = opts.sort && SORT_MAP[opts.sort] ? opts.sort : 'last_used';
	const dir: 'asc' | 'desc' = opts.dir === 'asc' ? 'asc' : 'desc';
	const orderBy = SORT_MAP[sortKey][dir];
	const q = opts.q?.trim();
	const tagWords = opts.tags ?? [];
	// D4 padded LIKE: one condition per word, AND-composed. Padded on both
	// sides so a word matches whole words only; ESCAPE keeps `_` literal.
	const tagConds = tagWords.map(() => "(' ' || tags || ' ') LIKE ? ESCAPE '\\'");
	const tagParams = tagWords.map((t) => `% ${escLike(t)} %`);
	const qCond = "(label LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\')";

	try {
		if (q) {
			const like = `${escLike(q)}%`;
			const where = [qCond, ...tagConds].join(' AND ');
			const rows = db
				.prepare(
					`SELECT ${SELECT_COLS} FROM prompts
           WHERE ${where}
           ORDER BY ${orderBy}
           LIMIT ? OFFSET ?`
				)
				.all(like, like, ...tagParams, limit, offset) as unknown as PromptRecord[];
			const total = (
				db.prepare(`SELECT COUNT(*) AS n FROM prompts WHERE ${where}`).get(like, like, ...tagParams) as {
					n: number;
				}
			).n;
			return { rows, total };
		}
		const where = tagConds.join(' AND ');
		const whereSql = where ? ` WHERE ${where}` : '';
		const rows = db
			.prepare(
				`SELECT ${SELECT_COLS} FROM prompts${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
			)
			.all(...tagParams, limit, offset) as unknown as PromptRecord[];
		const total = (
			db.prepare(`SELECT COUNT(*) AS n FROM prompts${whereSql}`).get(...tagParams) as {
				n: number;
			}
		).n;
		return { rows, total };
	} catch (e) {
		warn('listPrompts failed:', e);
		return { rows: [], total: 0 };
	}
}

/**
 * Create a prompt manually (ADR E4). If text already exists, returns the
 * existing row as a 409-info object instead of inserting. Manual create ≠
 * upsert — never silently bumps use_count.
 */
export function createPrompt(
	text: string,
	label?: string | null,
	tags?: string[],
	opts?: { use_count?: number; macro?: boolean }
): { ok: true; record: PromptRecord } | { ok: false; existing: PromptRecord | null } {
	const trimmed = text.trim();
	if (!trimmed) return { ok: false, existing: null };
	const db = openPromptsDb();
	if (!db) return { ok: false, existing: null };

	try {
		const existing = db
			.prepare(`SELECT ${SELECT_COLS} FROM prompts WHERE text = ?`)
			.get(trimmed) as unknown as PromptRecord | undefined;
		if (existing) return { ok: false, existing };

		const cleanLabel = label ? label.trim().slice(0, 60) || null : null;
		// D1: words are grammar-normalized (lowercase, dedupe, drop invalid)
		// and space-joined — the stored form is always canonical.
		const cleanTags = joinTagWords(tags ?? []);
		// Seed overrides (Add dialog aligned with Edit): use_count floored at
		// 1 like the PATCH path; absent = the insert defaults (1 / 0).
		const seededUses = Math.max(1, Math.floor(opts?.use_count ?? 1));
		const seededMacro = opts?.macro === true ? 1 : 0;
		db.prepare(
			`INSERT INTO prompts (label, text, use_count, macro, last_used_at, created_at, tags)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?)`
		).run(cleanLabel, trimmed, seededUses, seededMacro, cleanTags);
		pruneIfNeeded(db);
		const row = db
			.prepare(`SELECT ${SELECT_COLS} FROM prompts WHERE text = ?`)
			.get(trimmed) as unknown as PromptRecord | undefined;
		return { ok: true, record: row! };
	} catch (e) {
		warn('createPrompt failed:', e);
		return { ok: false, existing: null };
	}
}

/**
 * Update a prompt's text, label, and/or use_count (ADR E4 PATCH extend).
 * `use_count` is floored at 1 (reset). Returns the updated row or null.
 */
export function updatePrompt(
	id: number,
	fields: { text?: string; label?: string | null; use_count?: number; macro?: boolean; tags?: string }
): PromptRecord | null {
	const db = openPromptsDb();
	if (!db) return null;
	try {
		const sets: string[] = [];
		const args: (string | number | null)[] = [];

		if (fields.text !== undefined) {
			const trimmed = fields.text.trim();
			if (!trimmed) return null;
			sets.push('text = ?');
			args.push(trimmed);
		}
		if (fields.label !== undefined) {
			const clean =
				fields.label === null ? null : fields.label.trim().slice(0, 60) || null;
			sets.push('label = ?');
			args.push(clean);
		}
		if (fields.use_count !== undefined) {
			sets.push('use_count = ?');
			args.push(Math.max(1, Math.floor(fields.use_count)));
		}
		if (fields.macro !== undefined) {
			sets.push('macro = ?');
			args.push(fields.macro ? 1 : 0);
		}
		if (fields.tags !== undefined) {
			// Normalize through the grammar (D3): parse + join, so the stored
			// form is always the canonical space-joined lowercase words.
			sets.push('tags = ?');
			args.push(joinTagWords(parseTagWords(fields.tags)));
		}
		if (sets.length === 0) return null;

		args.push(id);
		const res = db
			.prepare(`UPDATE prompts SET ${sets.join(', ')} WHERE id = ?`)
			.run(...args);
		if (res.changes === 0) return null;
		return db
			.prepare(`SELECT ${SELECT_COLS} FROM prompts WHERE id = ?`)
			.get(id) as unknown as PromptRecord;
	} catch (e) {
		warn('updatePrompt failed:', e);
		return null;
	}
}
