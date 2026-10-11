/**
 * prompts-db search unit tests (coverage round 2026-10-11) — the paths the
 * shelf suite leaves dark: the default PREFIX mode (label/text LIKE + escLike
 * escaping), its catch degrade, and the multi-term LIKE-AND paths (no
 * indexable term, FTS-failure degrade). Real sqlite via the DSI_PROMPTS_DB
 * env seam — never a mock of the module (Behavioral Commitment 10).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	__resetPromptsDbCache,
	closePromptsDb,
	openPromptsDb,
	PROMPTS_DB_ENV
} from '$lib/server/prompts/connection.js';
import { escLike, searchPrompts } from '$lib/server/prompts/search.js';

let tmpRoot: string;
let dbFile: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), 'dsi-prompts-search-'));
	dbFile = join(tmpRoot, 'prompts.sqlite');
	process.env[PROMPTS_DB_ENV] = dbFile;
	__resetPromptsDbCache();
});

afterEach(() => {
	closePromptsDb();
	delete process.env[PROMPTS_DB_ENV];
	vi.restoreAllMocks();
});

/** Seed direct rows with explicit ids/use_count for deterministic order. */
function seed(rows: { id?: number; label?: string | null; text: string; use_count?: number; macro?: number }[]): void {
	const db = openPromptsDb(dbFile)!;
	const ins = db.prepare(
		"INSERT INTO prompts (id, label, text, use_count, macro, last_used_at, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
	);
	for (const r of rows) {
		ins.run(r.id ?? null, r.label ?? null, r.text, r.use_count ?? 1, r.macro ?? 0);
	}
}

describe('escLike', () => {
	it('escapes backslash, percent, and underscore', () => {
		expect(escLike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
	});
});

describe('default prefix mode (no opts.mode)', () => {
	it('matches label OR text prefix, use_count DESC ordering', () => {
		seed([
			{ id: 1, label: 'Loader', text: 'unrelated', use_count: 1 },
			{ id: 2, label: null, text: 'load the config', use_count: 7 },
			{ id: 3, label: null, text: 'a download link', use_count: 9 }
		]);
		// 'load' as a PREFIX: rows 1 and 2 match; row 3 only contains it
		const rows = searchPrompts('load', 5);
		expect(rows.map((r) => r.id)).toEqual([2, 1]);
	});

	it('is case-insensitive', () => {
		seed([{ id: 1, text: 'LOAD the config' }]);
		expect(searchPrompts('loa', 5).map((r) => r.id)).toEqual([1]);
		expect(searchPrompts('LOA', 5).map((r) => r.id)).toEqual([1]);
	});

	it('honors the limit', () => {
		seed([
			{ id: 1, text: 'load one', use_count: 2 },
			{ id: 2, text: 'load two', use_count: 1 }
		]);
		expect(searchPrompts('load', 1).map((r) => r.id)).toEqual([1]);
	});

	it('escapes LIKE wildcards in the key so they match literally', () => {
		seed([{ id: 1, text: 'full 100 percent done' }]);
		// a literal '%' key matches nothing — it is escaped, not a wildcard
		expect(searchPrompts('%', 5)).toEqual([]);
		seed([{ id: 2, text: '50% off sale' }]);
		expect(searchPrompts('50%', 5).map((r) => r.id)).toEqual([2]); // escaped % matches the literal prefix
	});

	it('filters by the macro flag when one is given', () => {
		seed([
			{ id: 1, text: 'load ordinary', macro: 0 },
			{ id: 2, text: 'load macro', macro: 1 }
		]);
		expect(searchPrompts('load', 5, { macro: 1 }).map((r) => r.id)).toEqual([2]);
		expect(searchPrompts('load', 5, { macro: 0 }).map((r) => r.id)).toEqual([1]);
	});

	it('returns [] for a blank key and never touches the db query path', () => {
		seed([{ id: 1, text: 'load' }]);
		expect(searchPrompts('   ', 5)).toEqual([]);
	});

	it('degrades to [] when the query fails (catch arm warns)', () => {
		seed([{ id: 1, text: 'load' }]);
		const db = openPromptsDb(dbFile)!;
		db.exec('DROP TABLE prompts'); // prepare() will throw on the next query
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(searchPrompts('load', 5)).toEqual([]); // never throws — degrade contract
	});
});

describe('multi-term contains — LIKE-AND paths', () => {
	it('no indexable term (all sub-3-char) goes straight to LIKE-AND', () => {
		seed([
			{ id: 1, text: 'ab cd summary' },
			{ id: 2, text: 'ab only' }
		]);
		const rows = searchPrompts('ab;cd', 5, { mode: 'contains' });
		expect(rows.map((r) => r.id)).toEqual([1]);
	});

	it('LIKE-AND terms are escaped (literal % matches nothing)', () => {
		seed([{ id: 1, text: 'ab cd' }]);
		expect(searchPrompts('ab;%', 5, { mode: 'contains' })).toEqual([]);
	});

	it('degrades to LIKE-AND when FTS is unavailable (catch arm)', () => {
		seed([
			{ id: 1, text: 'alpha beta reader' },
			{ id: 2, text: 'alpha only' }
		]);
		const db = openPromptsDb(dbFile)!;
		db.exec('DROP TABLE prompts_fts'); // ftsAndContains will throw
		const rows = searchPrompts('alpha;beta', 5, { mode: 'contains' });
		expect(rows.map((r) => r.id)).toEqual([1]);
	});
});
