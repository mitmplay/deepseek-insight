/**
 * prompts-db similarity (2026-10-10) — fuzzy-matching math of the Shelf,
 * moved WHOLE from db.ts (ADR-0019 standard, ADR-0022 W2): multi-keyword
 * query parsing, tier-2 fuzzy constants, Dice/edit-distance scoring,
 * per-term best-line scoring, trigram expression building, and the fuzzy
 * re-rank. Server-local by design. Pure module: no I/O of its own —
 * callers hand in the open DatabaseSync. Moved verbatim from db.ts by
 * line range; private helpers widened to default-public where the shell
 * or siblings call them (sanctioned seam, no signature changes).
 */
import type { DatabaseSync } from 'node:sqlite';
import { macroCond, SELECT_COLS, type PromptRecord } from './connection.js';

// ── Multi-keyword query parsing (ADR 2026-08-19 Semicolon Search S1) ──

/** Query term as carried through the tiers: display + match forms. */
export interface QueryTerm {
	/** Trimmed, case-preserved fragment for display/echo comparisons. */
	raw: string;
	/** Lowercased form for matching (trigram FTS is ASCII case-folding). */
	lower: string;
}

/** Trigram index needs ≥3-char keys; below this tier 0 falls back to LIKE. */
export const CONTAINS_MIN_FTS = 3;

/** Candidate-pool caps: per-term pool (bm25) and the union budget (S3). */
export const FUZZY_CANDIDATE_LIMIT = 50;
export const FUZZY_UNION_LIMIT = 100;

/** Dice similarity floor for tier-2 inclusion — PER TERM (min-combine,
 *  S3): a row is only as strong as its weakest keyword. Below = noise; the
 *  ADR word-share decoy scores 0.174 — excluded. */
export const FUZZY_DICE_FLOOR = 0.3;

/** Minimum key length for tier-2 fuzzy (single-term): below, a tier-1
 *  miss is an honest miss (OCI v1.2 contract; PRD "fuzzy Dice ≥4 chars"). */
export const FUZZY_MIN_LEN = 4;

/**
 * Split a `?`-search key into keyword terms (ADR S1; separator charset
 * widened by ADR-0014 D2): split on `,`, `;`, `+`, or whitespace, trim,
 * drop empties, dedupe (case-insensitive, first spelling wins).
 * `adr, spec + task` → [adr, spec, task]; `load;;skill;` → [load, skill];
 * single term → array of one — the caller decides which path runs.
 * Empty/blank key → []. Pure; exported for tests.
 */
export function splitQueryTerms(key: string): QueryTerm[] {
	const seen = new Set<string>();
	const terms: QueryTerm[] = [];
	for (const frag of key.split(/[,;+\s]+/)) {
		const raw = frag.trim();
		if (!raw) continue;
		const lower = raw.toLowerCase();
		if (seen.has(lower)) continue;
		seen.add(lower);
		terms.push({ raw, lower });
	}
	return terms;
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
export function fuzzyReRank(
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
