/**
 * prompts-db search (2026-10-10) — the tiered `?` waterfall of the Shelf,
 * moved WHOLE from db.ts (ADR-0019 standard, ADR-0022 W3): tier 0 LIKE
 * scan, tier 1 FTS phrase MATCH, tier 2 per-term fuzzy re-rank, plus the
 * prefix contract, echo guard, and LIKE escaping. Degrade contract holds:
 * every tier failure falls through, never throws to a route.
 *
 * Imports the connection seam (open/macroCond/SELECT_COLS) and the
 * similarity seam (splitQueryTerms/fuzzyReRank/tier constants). Moved
 * verbatim from db.ts by line range.
 */
import type { DatabaseSync } from 'node:sqlite';
import { macroCond, openPromptsDb, SELECT_COLS, warn, type PromptRecord } from './connection.js';
import {
	CONTAINS_MIN_FTS,
	FUZZY_MIN_LEN,
	fuzzyReRank,
	splitQueryTerms,
	type QueryTerm
} from './similarity.js';

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

/** Escape LIKE wildcards in user input so the prefix matches literally. */
export function escLike(s: string): string {
	return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ── `?` tiered search (ADR v1.2 F2; Semicolon Search S1–S3) ──



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
