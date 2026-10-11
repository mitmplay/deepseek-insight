/**
 * prompts-db similarity unit tests (coverage round 2026-10-11) — the fuzzy
 * math of the Shelf: splitQueryTerms charset/dedupe, Dice duplicate-gram
 * decrement, wordSimilarity edit fallback, and the fuzzyReRank ordering
 * tiebreakers (score → use_count → last_used_at). Real sqlite via the
 * DSI_PROMPTS_DB env seam (Behavioral Commitment 10 — never mock the
 * module).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetPromptsDbCache, closePromptsDb, openPromptsDb, PROMPTS_DB_ENV } from '$lib/server/prompts/connection.js';
import {
	diceSimilarity,
	fuzzyReRank as rerank2,
	splitQueryTerms as split2,
	wordSimilarity
} from '$lib/server/prompts/similarity.js';

let tmpRoot: string;
let dbFile: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), 'dsi-prompts-sim-'));
	dbFile = join(tmpRoot, 'prompts.sqlite');
	process.env[PROMPTS_DB_ENV] = dbFile;
	__resetPromptsDbCache();
});

afterEach(() => {
	closePromptsDb();
	delete process.env[PROMPTS_DB_ENV];
});

afterAll(() => {
	delete process.env[PROMPTS_DB_ENV];
});

/** Seed direct rows with explicit ids/timestamps for deterministic sort. */
function seed(rows: { id?: number; label?: string | null; text: string; use_count?: number; last?: string }[]): void {
	const db = openPromptsDb(dbFile)!;
	const ins = db.prepare(
		'INSERT INTO prompts (id, label, text, use_count, last_used_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
	);
	for (const r of rows) {
		ins.run(r.id ?? null, r.label ?? null, r.text, r.use_count ?? 1, r.last ?? '2026-01-01 00:00:00', r.last ?? '2026-01-01 00:00:00');
	}
}

describe('splitQueryTerms', () => {
	it('splits on comma, semicolon, plus, and whitespace; trims and drops empties', () => {
		expect(split2('adr, spec + task')).toEqual([
			{ raw: 'adr', lower: 'adr' },
			{ raw: 'spec', lower: 'spec' },
			{ raw: 'task', lower: 'task' }
		]);
		expect(split2('load;;skill;')).toEqual([
			{ raw: 'load', lower: 'load' },
			{ raw: 'skill', lower: 'skill' }
		]);
		expect(split2('  ')).toEqual([]);
		expect(split2('')).toEqual([]);
	});

	it('dedupes case-insensitively, first spelling wins', () => {
		expect(split2('Load;load;LOAD;lad')).toEqual([
			{ raw: 'Load', lower: 'load' },
			{ raw: 'lad', lower: 'lad' }
		]);
	});
});

describe('diceSimilarity', () => {
	it('identical strings score 1, disjoint strings 0', () => {
		expect(diceSimilarity('abcdef', 'abcdef')).toBe(1);
		expect(diceSimilarity('xxxxxx', 'abcdef')).toBe(0);
	});

	it('strings shorter than 3 trigram chars score 0 (both arms)', () => {
		expect(diceSimilarity('ab', 'ab')).toBe(0); // aCount path: grams.size === 0
		expect(diceSimilarity('abcdef', 'ab')).toBe(0); // bCount path: b loop never runs
	});

	it('counts shared duplicate grams with multiplicity (decrement arm)', () => {
		// 'aaaaa' has grams aaa×3; 'aaa' has aaa×1 → shared 1 of 3+1
		expect(diceSimilarity('aaaaa', 'aaa')).toBe((2 * 1) / (3 + 1));
		// 'aaaaaa' aaa×4 vs 'aaaa' aaa×2 → shared 2 of 4+2
		expect(diceSimilarity('aaaaaa', 'aaaa')).toBe((2 * 2) / (4 + 2));
	});
});

describe('wordSimilarity', () => {
	it('falls back to normalized edit distance when Dice is 0', () => {
		// 'lod' vs 'load': Dice 0 (only 1 gram each, none shared), edit 0.75
		expect(wordSimilarity('lod', 'load')).toBeCloseTo(0.75, 5);
	});

	it('equal strings score 1 via the levenshtein a===b arm', () => {
		expect(wordSimilarity('load', 'load')).toBe(1);
	});

	it('empty-vs-nonempty uses the length arms of levenshtein', () => {
		expect(wordSimilarity('', 'load')).toBe(0); // edit 0 → max(dice 0, 0)
	});
});

describe('fuzzyReRank ordering + pool caps', () => {
	it('breaks score ties by use_count, then last_used_at', () => {
		seed([
			{ id: 1, text: 'load ramp one', use_count: 2, last: '2026-01-01 00:00:00' },
			{ id: 2, text: 'load ramp two', use_count: 5, last: '2026-01-01 00:00:00' },
			{ id: 3, text: 'load ramp three', use_count: 5, last: '2026-02-01 00:00:00' },
			{ id: 4, text: 'load ramp four', use_count: 5, last: '2026-02-01 00:00:00' }
		]);
		const db = openPromptsDb(dbFile)!;
		const terms = split2('load');
		const rows = rerank2(db, terms, 10, undefined);
		// all four score 1 (exact contains); sorted use_count DESC, then
		// last_used_at ASC within the tie (the comparator's observed order),
		// equal keys keep pool insertion order
		expect(rows.map((r) => r.id)).toEqual([2, 3, 4, 1]);
	});

	it('honors the limit parameter', () => {
		seed([
			{ id: 1, text: 'kite launcher one' },
			{ id: 2, text: 'kite launcher two' }
		]);
		const db = openPromptsDb(dbFile)!;
		expect(rerank2(db, split2('kite'), 1, undefined).map((r) => r.id)).toEqual([1]);
	});

	it('skips sub-3-char terms (no trigrams) and returns [] on an empty pool', () => {
		seed([{ id: 1, text: 'ab cd ef' }]);
		const db = openPromptsDb(dbFile)!;
		expect(rerank2(db, split2('ab'), 5, undefined)).toEqual([]);
	});

	it('min-combines per term: a weak term sinks the row below the floor', () => {
		seed([
			{ id: 1, text: 'kite launcher' },
			{ id: 2, text: 'kite zzzzzz' }
		]);
		const db = openPromptsDb(dbFile)!;
		// 'kite' matches both; 'zzzz' matches only row 2 fuzzily-ish… row 1
		// min-combines kite(1) × zzzz(0) → excluded
		const rows = rerank2(db, split2('kite;zzzz'), 5, undefined);
		expect(rows.map((r) => r.id)).toEqual([2]);
	});

	it('caps the per-term pool at FUZZY_CANDIDATE_LIMIT rows (bm25)', () => {
		const db = openPromptsDb(dbFile)!;
		const ins = db.prepare("INSERT INTO prompts (text) VALUES (?)");
		for (let i = 0; i < 120; i++) ins.run('load bearing wall ' + i);
		const rows = rerank2(db, split2('load'), 500, undefined);
		expect(rows.length).toBe(50); // FUZZY_CANDIDATE_LIMIT — one term, one pool
	});

	it('survives a term whose pool query throws (catch arm)', () => {
		seed([{ id: 1, text: 'load bearing wall' }]);
		const db = openPromptsDb(dbFile)!;
		// corrupt: drop the FTS index → the trigram pool query throws, the
		// per-term catch swallows it, pool is empty → []
		db.exec('DROP TABLE prompts_fts');
		expect(rerank2(db, split2('load'), 5, undefined)).toEqual([]);
	});

	it('macro filter reaches the pool query (macro=1)', () => {
		seed([
			{ id: 1, text: 'load bearing wall', use_count: 1 }
		]);
		const db = openPromptsDb(dbFile)!;
		db.exec('UPDATE prompts SET macro = 1 WHERE id = 1');
		expect(rerank2(db, split2('load'), 5, 1).map((r) => r.id)).toEqual([1]);
		expect(rerank2(db, split2('load'), 5, 0)).toEqual([]);
	});

	it('a row whose label matches scores via the label-as-first-line rule', () => {
		seed([
			{ id: 1, label: 'Loader', text: 'unrelated body text', use_count: 1 }
		]);
		const db = openPromptsDb(dbFile)!;
		const rows = rerank2(db, split2('loader'), 5, undefined);
		expect(rows.map((r) => r.id)).toEqual([1]);
	});
});
