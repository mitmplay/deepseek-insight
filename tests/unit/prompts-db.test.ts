/**
 * prompts-db tests (Task 1.1-T) — the Shelf's server contracts: schema v2
 * shape + migration, upsert counting, the `?` tier waterfall (short-key
 * LIKE → FTS contains → fuzzy min-combine with echo guard), manager
 * queries, the 5,000-row cap prune, FTS-failure degrade, and the silent
 * degrade contract (unopenable DB ⇒ empty/false, never a throw).
 *
 * Spec: dev/specs/2026-08-28 - DSI Suggest Strip (Tasks 1.1/1.1-T).
 * Every case runs on a seeded tmp DB via the DSI_PROMPTS_DB env seam
 * (never a mock of the module — Behavioral Commitment 10).
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	__resetPromptsDbCache,
	countPromptUse,
	createPrompt,
	deletePrompt,
	diceSimilarity,
	findPromptByText,
	FUZZY_MIN_LEN,
	listPrompts,
	openPromptsDb,
	PROMPTS_DB_ENV,
	recordPromptUse,
	renamePromptLabel,
	resolvePromptsDbPath,
	searchPrompts,
	splitQueryTerms,
	updatePrompt,
	wordSimilarity
} from '$lib/server/prompts/db.js';

let tmpRoot: string;
let dbFile: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), 'dsi-prompts-db-'));
	dbFile = join(tmpRoot, 'prompts.sqlite');
	process.env[PROMPTS_DB_ENV] = dbFile;
	__resetPromptsDbCache();
});

afterEach(() => {
	__resetPromptsDbCache();
	delete process.env[PROMPTS_DB_ENV];
});

afterAll(() => {
	__resetPromptsDbCache();
	delete process.env[PROMPTS_DB_ENV];
});

/** Seed helper — direct inserts with explicit ids/timestamps so prune
 *  ordering and ranking are deterministic. */
function seed(rows: { id?: number; label?: string | null; text: string; use_count?: number; last?: string }[]): void {
	const db = openPromptsDb(dbFile)!;
	db.exec('BEGIN');
	const ins = db.prepare(
		`INSERT INTO prompts (id, label, text, use_count, last_used_at, created_at)
		 VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
	);
	for (const r of rows) {
		ins.run(
			r.id ?? null,
			r.label ?? null,
			r.text,
			r.use_count ?? 1,
			r.last ?? '2026-01-01 00:00:00',
			r.last ?? null
		);
	}
	db.exec('COMMIT');
}

describe('path resolution (env seam)', () => {
	it('DSI_PROMPTS_DB env points the default handle at the tmp file', () => {
		expect(resolvePromptsDbPath()).toBe(dbFile);
		const db = openPromptsDb(); // no-arg form resolves via env
		expect(db).not.toBeNull();
	});

	it('without env, defaults to the ~/.dsi sibling of settings.yaml', () => {
		delete process.env[PROMPTS_DB_ENV];
		// Isolate from the operator's live settings.yaml: a missing config
		// file reads as no `prompts.dbPath` → the default sibling wins.
		process.env.DSI_CONFIG_PATH = join(tmpRoot, 'settings.yaml');
		const p = resolvePromptsDbPath();
		delete process.env.DSI_CONFIG_PATH;
		expect(p.endsWith(join('.dsi', 'prompts.sqlite'))).toBe(true);
	});

	it('explicit argument wins over env', () => {
		expect(resolvePromptsDbPath('/tmp/other.db')).toBe('/tmp/other.db');
	});
});

describe('schema v4 shape (fresh open)', () => {
	it('creates prompts + FTS5 shadow + sync triggers + tags column, user_version=4', () => {
		const db = openPromptsDb(dbFile)!;
		const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
		expect(version).toBe(4);
		const cols = (
			db.prepare('PRAGMA table_info(prompts)').all() as { name: string }[]
		).map((c) => c.name);
		expect(cols[cols.length - 1]).toBe('tags'); // v4 appends AFTER the 7 pinned columns
		const idxNames = (
			db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
		).map((r) => r.name);
		expect(idxNames).toContain('idx_prompts_tags');
		const names = (
			db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index')").all() as {
				name: string;
			}[]
		).map((r) => r.name);
		expect(names).toContain('prompts');
		expect(names).toContain('prompts_fts');
		expect(names).toContain('prompts_ai');
		expect(names).toContain('prompts_ad');
		expect(names).toContain('prompts_au');
		expect(names).toContain('idx_prompts_prune');
	});

	it('migrates a v0 label-less DB in place to v4 keeping its rows', () => {
		// v0 shape: no label, no created_at, version 0
		const db = openPromptsDb(dbFile)!;
		db.exec('DROP TRIGGER prompts_ai; DROP TRIGGER prompts_ad; DROP TRIGGER prompts_au;');
		db.exec('DROP TABLE prompts_fts;');
		db.exec('DROP TABLE prompts;');
		db.exec(`CREATE TABLE prompts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			text TEXT NOT NULL,
			use_count INTEGER NOT NULL DEFAULT 1,
			last_used_at TEXT NOT NULL DEFAULT (datetime('now'))
		);`);
		db.exec("INSERT INTO prompts (text, use_count) VALUES ('legacy row', 7)");
		db.exec('PRAGMA user_version = 0;');
		db.close();
		__resetPromptsDbCache();

		const again = openPromptsDb(dbFile)!; // re-open runs migrate
		const version = (again.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
		expect(version).toBe(4);
		const cols = (again.prepare('PRAGMA table_info(prompts)').all() as { name: string }[]).map((c) => c.name);
		expect(cols).toContain('label');
		expect(cols).toContain('created_at');
		expect(cols).toContain('macro');
		const row = findPromptByText('legacy row');
		expect(row?.use_count).toBe(7);
		expect(row?.label).toBeNull();
		expect(row?.created_at).not.toBeNull();
		// FTS shadow rebuilt over the legacy content
		expect(searchPrompts('legacy', 5, { mode: 'contains' }).map((r) => r.text)).toContain('legacy row');
	});

	it('migrates a copied v3 fixture file to v4 in place: rows intact, tags column, FTS alive', () => {
		// Build a REAL v3 file with a RAW connection: the pinned 7-column
		// shape, no tags, version 3 — FTS shadow + sync triggers intact and
		// backfilled (a genuine v3 file carries them). openPromptsDb is never
		// touched during construction, so nothing pre-migrates the file.
		const raw = new DatabaseSync(dbFile);
		raw.exec(`CREATE TABLE prompts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			label TEXT,
			text TEXT NOT NULL,
			use_count INTEGER NOT NULL DEFAULT 1,
			macro INTEGER NOT NULL DEFAULT 0,
			last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			UNIQUE(text)
		);`);
		raw.exec(`CREATE VIRTUAL TABLE prompts_fts USING fts5(
			label, text, content='prompts', content_rowid='id', tokenize='trigram'
		);`);
		raw.exec(`CREATE TRIGGER prompts_ai AFTER INSERT ON prompts BEGIN
			INSERT INTO prompts_fts(rowid, label, text) VALUES (new.id, new.label, new.text);
		END;`);
		raw.exec(`CREATE TRIGGER prompts_ad AFTER DELETE ON prompts BEGIN
			INSERT INTO prompts_fts(prompts_fts, rowid, label, text) VALUES ('delete', old.id, old.label, old.text);
		END;`);
		raw.exec(`CREATE TRIGGER prompts_au AFTER UPDATE OF label, text ON prompts BEGIN
			INSERT INTO prompts_fts(prompts_fts, rowid, label, text) VALUES ('delete', old.id, old.label, old.text);
			INSERT INTO prompts_fts(rowid, label, text) VALUES (new.id, new.label, new.text);
		END;`);
		raw.exec("INSERT INTO prompts (label, text, use_count, macro) VALUES ('Git flow', 'commit all and push', 9, 0)");
		raw.exec("INSERT INTO prompts (label, text, use_count, macro) VALUES (NULL, 'rca template', 3, 1)");
		raw.exec('PRAGMA user_version = 3;');
		raw.close();
		__resetPromptsDbCache();

		const v4 = openPromptsDb(dbFile)!; // migrate on open
		const version = (v4.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
		expect(version).toBe(4);

		// Rows intact — no rebuild, no data loss.
		const rows = v4.prepare('SELECT text, macro, tags FROM prompts ORDER BY id').all() as {
			text: string;
			macro: number;
			tags: string;
		}[];
		expect(rows).toEqual([
			{ text: 'commit all and push', macro: 0, tags: '' },
			{ text: 'rca template', macro: 1, tags: '' }
		]);

		// The cheap path: NO prompts_new swap left behind.
		const tables = (v4.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
		expect(tables).not.toContain('prompts_new');

		// FTS shadow alive: trigram search still ranks the migrated rows.
		const fts = v4.prepare("SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH '\"commit\"'").all();
		expect(fts.length).toBe(1);

		// Filter index exists.
		const idx = (v4.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map((r) => r.name);
		expect(idx).toContain('idx_prompts_tags');
	});

	it('v4 migration is idempotent on double-open', () => {
		const db = openPromptsDb(dbFile)!;
		createPrompt('idempotent probe', null, ['git']);
		db.close();
		__resetPromptsDbCache();

		const once = openPromptsDb(dbFile)!;
		const v1 = (once.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
		once.close();
		__resetPromptsDbCache();
		const twice = openPromptsDb(dbFile)!;
		const v2 = (twice.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
		expect(v1).toBe(4);
		expect(v2).toBe(4);
		// Column added exactly once (a second ALTER would throw and degrade).
		const cols = (twice.prepare('PRAGMA table_info(prompts)').all() as { name: string }[]).map((c) => c.name);
		expect(cols.filter((c) => c === 'tags').length).toBe(1);
	});

	it('opens the operator seeded v2 file shape (copied, no writes)', () => {
		// Build a REAL v2 file with a RAW connection — hermetic, never the
		// live ~/.dsi/prompts.sqlite (operator-owned content drifts and once
		// ranked a user prompt above the seeded row). v2 shape: the 6-column
		// pre-macro table, FTS shadow + sync triggers backfilled, version 2.
		// openPromptsDb is untouched during construction, so nothing
		// pre-migrates the file.
		const raw = new DatabaseSync(dbFile);
		raw.exec(`CREATE TABLE prompts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			label TEXT,
			text TEXT NOT NULL,
			use_count INTEGER NOT NULL DEFAULT 1,
			last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			UNIQUE(text)
		);`);
		raw.exec(`CREATE VIRTUAL TABLE prompts_fts USING fts5(
			label, text, content='prompts', content_rowid='id', tokenize='trigram'
		);`);
		raw.exec(`CREATE TRIGGER prompts_ai AFTER INSERT ON prompts BEGIN
			INSERT INTO prompts_fts(rowid, label, text) VALUES (new.id, new.label, new.text);
		END;`);
		raw.exec(`CREATE TRIGGER prompts_ad AFTER DELETE ON prompts BEGIN
			INSERT INTO prompts_fts(prompts_fts, rowid, label, text) VALUES ('delete', old.id, old.label, old.text);
		END;`);
		raw.exec(`CREATE TRIGGER prompts_au AFTER UPDATE OF label, text ON prompts BEGIN
			INSERT INTO prompts_fts(prompts_fts, rowid, label, text) VALUES ('delete', old.id, old.label, old.text);
			INSERT INTO prompts_fts(rowid, label, text) VALUES (new.id, new.label, new.text);
		END;`);
		// A distractor that also matches 'load' but ranks below on use_count —
		// the very drift the live-DB copy used to import non-deterministically.
		raw.exec("INSERT INTO prompts (label, text, use_count, last_used_at, created_at) VALUES ('DSH DSI', 'open the dsh insight panel', 3, '2026-01-02 00:00:00', '2026-01-02 00:00:00')");
		raw.exec("INSERT INTO prompts (label, text, use_count, last_used_at, created_at) VALUES ('load project AIP, OCI', 'load project folder `~/agentic-ai`', 207, '2026-01-03 00:00:00', '2026-01-03 00:00:00')");
		raw.exec('PRAGMA user_version = 2;');
		raw.close();
		__resetPromptsDbCache();

		const rows = searchPrompts('load', 5, { mode: 'contains' });
		expect(rows.length).toBeGreaterThan(0);
		expect(rows[0].label ?? rows[0].text).toContain('load project');
		// The open migrated the v2 file to v4 in place: macro + tags added.
		const v4 = openPromptsDb(dbFile)!;
		const version = (v4.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
		expect(version).toBe(4);
		const cols = (v4.prepare('PRAGMA table_info(prompts)').all() as { name: string }[]).map((c) => c.name);
		expect(cols).toContain('macro');
		expect(cols).toContain('tags');
	});
	it('macro filter: macro=1 returns only macro rows, macro=0 only ordinary', () => {
		// Echo-guard safety: neither text STARTS with the query key, so a
		// sole filtered hit is not mistaken for the recorded query itself.
		createPrompt('alpha macro probe one');
		createPrompt('beta macro probe two');
		const alpha = findPromptByText('alpha macro probe one')!;
		updatePrompt(alpha.id, { macro: true });
		const all = searchPrompts('macro', 5, { mode: 'contains' });
		expect(all).toHaveLength(2);
		const macros = searchPrompts('macro', 5, { mode: 'contains', macro: 1 });
		expect(macros).toHaveLength(1);
		expect(macros[0].macro).toBe(1);
		const plain = searchPrompts('macro', 5, { mode: 'contains', macro: 0 });
		expect(plain).toHaveLength(1);
		expect(plain[0].macro).toBe(0);
		// short-key tier 0 (LIKE) honors the filter too
		expect(searchPrompts('mac', 5, { mode: 'contains', macro: 1 })).toHaveLength(1);
	});
});

describe('recordPromptUse — upsert counting', () => {
	it('first send inserts use_count=1; later sends increment + refresh last_used_at', () => {
		const first = recordPromptUse('load project folder');
		expect(first?.use_count).toBe(1);
		const second = recordPromptUse('load project folder');
		expect(second?.use_count).toBe(2);
		expect(second?.id).toBe(first?.id);
		expect(second!.last_used_at >= first!.last_used_at).toBe(true);
		expect((listPrompts({}).total)).toBe(1);
	});

	it('trims before matching and rejects blank text', () => {
		expect(recordPromptUse('   ')).toBeNull();
		const r = recordPromptUse('  spaced out  ');
		expect(r?.text).toBe('spaced out');
		expect(findPromptByText('spaced out')?.id).toBe(r?.id);
	});
});

describe('tier waterfall (mode=contains)', () => {
	beforeEach(() => {
		seed([
			{ id: 1, label: 'load project AIP, OCI', text: 'load project folder `~/agentic-ai/ai-proxy`', use_count: 207 },
			{ id: 2, text: 'load weekly report', use_count: 3 },
			{ id: 3, label: 'Deploy notes', text: 'ship it to staging', use_count: 5 },
			{ id: 4, text: 'unrelated grocery list', use_count: 1 }
		]);
	});

	it('tier 0 — short key (<3 chars) hits the LIKE floor, label or text', () => {
		const rows = searchPrompts('de', 10, { mode: 'contains' });
		expect(rows.map((r) => r.id)).toContain(3); // label "Deploy notes"
		const lo = searchPrompts('lo', 10, { mode: 'contains' });
		expect(lo.map((r) => r.id)).toContain(1); // "load …"
	});

	it('tier 1 — ≥3 chars uses FTS contains ("load" hits rows 1 and 2)', () => {
		const rows = searchPrompts('load', 10, { mode: 'contains' });
		expect(rows.map((r) => r.id).sort()).toEqual([1, 2]);
	});

	it('ranking — use_count DESC, then last_used_at DESC', () => {
		const rows = searchPrompts('load', 10, { mode: 'contains' });
		expect(rows[0].id).toBe(1); // 207 uses outranks 3
	});

	it('tier 2 — typo recovery: "lod;weekly" finds "load weekly report" (word-level 0.75)', () => {
		// The PRD's "lod"→"load" case: "lod" alone is a 3-char single key —
		// below FUZZY_MIN_LEN, an honest miss (pinned below). Inside a
		// multi-term key, the exact term's trigram pool drags the row in
		// and word-level similarity ("lod" vs "load" = 0.75) clears the floor.
		const rows = searchPrompts('lod;weekly', 10, { mode: 'contains' });
		expect(rows.map((r) => r.id)).toEqual([2]);
	});

	it('single short-typo key "lod" is an honest miss (FUZZY_MIN_LEN gate)', () => {
		expect(FUZZY_MIN_LEN).toBe(4);
		expect(searchPrompts('lod', 10, { mode: 'contains' })).toEqual([]);
	});

	it('tier 2 — single ≥4-char typo still recovers ("projct" → project)', () => {
		const rows = searchPrompts('projct', 10, { mode: 'contains' });
		expect(rows.map((r) => r.id)).toEqual([1]);
	});

	it('min-combine exclusion — a term under the 0.3 floor kills the row', () => {
		// Corrected 2026-08-28: the first draft asserted `load;zebra` would
		// exclude everything, but wordSimilarity('zebra','report') = 1-4/6 =
		// 0.333 clears the 0.3 floor legitimately (probe-verified). `xyzzy`
		// maxes at 0.167 over every line/word of every seeded row — a true
		// under-floor term. Working code untouched; assumption was wrong.
		expect(searchPrompts('load;xyzzy', 10, { mode: 'contains' })).toEqual([]);
	});

	it('multi-keyword AND — every term must hit ("load;report")', () => {
		const rows = searchPrompts('load;report', 10, { mode: 'contains' });
		expect(rows.map((r) => r.id)).toEqual([2]); // row 1 has no "report"
	});

	it('echo guard — the recorded query row as the ONLY hit is dropped', () => {
		recordPromptUse('deploy;qa steps here'); // recorded when sent as-is
		expect(searchPrompts('deploy;qa', 10, { mode: 'contains' })).toEqual([]);
		// but a genuine second hit keeps the echo row in play
		recordPromptUse('deploy;qa for real');
		const rows = searchPrompts('deploy;qa', 10, { mode: 'contains' });
		expect(rows.length).toBe(2);
	});

	it('FTS failure degrades to LIKE — search never throws', () => {
		const db = openPromptsDb(dbFile)!;
		db.exec('DROP TABLE prompts_fts;'); // simulate corruption
		const rows = searchPrompts('load', 10, { mode: 'contains' });
		expect(rows.map((r) => r.id).sort()).toEqual([1, 2]);
	});
});

describe('splitQueryTerms', () => {
	it('splits on ; and whitespace, drops empties, dedupes case-insensitively', () => {
		expect(splitQueryTerms('load;skill;;LOAD  feature-spec')).toEqual([
			{ raw: 'load', lower: 'load' },
			{ raw: 'skill', lower: 'skill' },
			{ raw: 'feature-spec', lower: 'feature-spec' }
		]);
		expect(splitQueryTerms('   ')).toEqual([]);
	});
});

describe('fuzzy math (server-local exports)', () => {
	it('wordSimilarity("lod","load") = 0.75 via edit distance (Dice alone is 0)', () => {
		expect(diceSimilarity('lod', 'load')).toBe(0);
		expect(wordSimilarity('lod', 'load')).toBeCloseTo(0.75, 5);
	});
});

describe('5,000-row cap prune', () => {
	it('overflow prunes oldest use_count=1 rows; multi-use rows survive', () => {
		const db = openPromptsDb(dbFile)!;
		const values: string[] = [];
		for (let i = 1; i <= 5000; i++) {
			// id 1: oldest but multi-use (2) — must survive; id 2: oldest one-use — pruned.
			const uses = i === 1 ? 2 : 1;
			const last = `datetime('now', '-${10000 - i} minutes')`;
			values.push(`(${i}, NULL, 'filler row ${i}', ${uses}, ${last}, ${last})`);
		}
		db.exec(
			`INSERT INTO prompts (id, label, text, use_count, last_used_at, created_at)
			 VALUES ${values.join(',')}`
		);
		expect((db.prepare('SELECT COUNT(*) n FROM prompts').get() as { n: number }).n).toBe(5000);

		const rec = recordPromptUse('brand new cap prompt'); // 5001 → prune 1
		expect(rec?.use_count).toBe(1);
		const count = (db.prepare('SELECT COUNT(*) n FROM prompts').get() as { n: number }).n;
		expect(count).toBe(5000);
		expect(findPromptByText('filler row 1')?.use_count).toBe(2); // multi-use survived
		expect(findPromptByText('filler row 2')).toBeNull(); // oldest one-use pruned
		expect(findPromptByText('brand new cap prompt')).not.toBeNull();
	});
});

describe('manager queries (listPrompts / create / update / delete)', () => {
	beforeEach(() => {
		seed([
			{ id: 1, label: 'Alpha', text: 'run alpha suite', use_count: 9, last: '2026-01-03 00:00:00' },
			{ id: 2, label: null, text: 'beta checklist', use_count: 4, last: '2026-01-05 00:00:00' },
			{ id: 3, label: 'Gamma', text: 'ship gamma build', use_count: 6, last: '2026-01-04 00:00:00' }
		]);
	});

	it('lists with sort uses asc + offset paging + total', () => {
		const page1 = listPrompts({ sort: 'uses', dir: 'asc', limit: 2 });
		expect(page1.rows.map((r) => r.id)).toEqual([2, 3]);
		expect(page1.total).toBe(3);
		const page2 = listPrompts({ sort: 'uses', dir: 'asc', limit: 2, offset: 2 });
		expect(page2.rows.map((r) => r.id)).toEqual([1]);
	});

	it('contains filter q matches label or text (mid-string too)', () => {
		const rows = listPrompts({ q: 'gam' });
		expect(rows.rows.map((r) => r.id)).toEqual([3]);
		expect(rows.total).toBe(1);
		// The 2026-09-19 contains fix: a mid-string word hits (the old
		// prefix filter `q%` could never match 'suite' in 'run alpha suite').
		const mid = listPrompts({ q: 'suite' });
		expect(mid.rows.map((r) => r.id)).toEqual([1]);
		const midLabel = listPrompts({ q: 'lph' }); // 'lph' inside label 'Alpha'
		expect(midLabel.rows.map((r) => r.id)).toEqual([1]);
	});

	it('unknown sort falls back to last_used DESC', () => {
		const rows = listPrompts({ sort: 'bogus' });
		expect(rows.rows.map((r) => r.id)).toEqual([2, 3, 1]); // 05 > 04 > 03
	});

	it('createPrompt inserts with label; duplicate text returns existing, no count bump', () => {
		const made = createPrompt('new one', 'Handle');
		expect(made.ok).toBe(true);
		if (made.ok) {
			expect(made.record.label).toBe('Handle');
			expect(made.record.use_count).toBe(1);
		}
		const dup = createPrompt('run alpha suite');
		expect(dup.ok).toBe(false);
		if (!dup.ok) expect(dup.existing?.id).toBe(1);
		expect(findPromptByText('run alpha suite')?.use_count).toBe(9); // untouched
	});

	it('createPrompt opts seed use_count/macro (Add-dialog alignment); absent = defaults 1/0', () => {
		const seeded = createPrompt('seeded probe', 'Seed', [], { use_count: 4, macro: true });
		expect(seeded.ok).toBe(true);
		if (seeded.ok) {
			expect(seeded.record.use_count).toBe(4);
			expect(seeded.record.macro).toBe(1);
		}
		const floored = createPrompt('floored probe', null, [], { use_count: 0 });
		expect(floored.ok && floored.record.use_count).toBe(1); // floor at 1 like PATCH
		const plain = createPrompt('plain probe');
		expect(plain.ok && plain.record.use_count).toBe(1);
		expect(plain.ok && plain.record.macro).toBe(0);
	});

	it('updatePrompt patches text/label subset, floors use_count at 1, 404-row → null', () => {
		const updated = updatePrompt(2, { label: 'Beta', use_count: 0 });
		expect(updated?.label).toBe('Beta');
		expect(updated?.use_count).toBe(1);
		const renamed = updatePrompt(1, { text: 'run alpha suite v2' });
		expect(renamed?.text).toBe('run alpha suite v2');
		expect(updatePrompt(999, { label: 'x' })).toBeNull();
		expect(updatePrompt(1, {})).toBeNull(); // empty subset
	});

	it('label uniqueness — rename onto a claimed label fails, clears with null', () => {
		expect(renamePromptLabel(2, 'Alpha')).toBe(false); // row 1 owns it
		expect(renamePromptLabel(2, 'Beta 2')).toBe(true);
		expect(renamePromptLabel(2, null)).toBe(true);
	});

	it('deletePrompt removes exactly the row', () => {
		expect(deletePrompt(3)).toBe(true);
		expect(deletePrompt(3)).toBe(false); // gone
		expect(listPrompts({}).total).toBe(2);
	});
});

describe('silent degrade (Behavioral Commitment 5)', () => {
	it('unopenable DB: every export returns empty/false/null — never throws', () => {
		process.env[PROMPTS_DB_ENV] = tmpRoot; // a DIRECTORY — open must fail
		__resetPromptsDbCache();
		expect(openPromptsDb()).toBeNull();
		expect(searchPrompts('load', 10, { mode: 'contains' })).toEqual([]);
		expect(recordPromptUse('anything')).toBeNull();
		expect(listPrompts({})).toEqual({ rows: [], total: 0 });
		expect(createPrompt('x')).toEqual({ ok: false, existing: null });
		expect(findPromptByText('x')).toBeNull();
		expect(updatePrompt(1, { label: 'x' })).toBeNull();
		expect(deletePrompt(1)).toBe(false);
		expect(renamePromptLabel(1, 'x')).toBe(false);
	});
});

describe('path resolution (prompts.dbPath config seam)', () => {
	const CONFIG_ENV = 'DSI_CONFIG_PATH';

	function writeSettings(yaml: string): void {
		writeFileSync(join(tmpRoot, 'settings.yaml'), yaml, 'utf-8');
		process.env[CONFIG_ENV] = join(tmpRoot, 'settings.yaml');
	}

	beforeEach(() => {
		delete process.env[PROMPTS_DB_ENV];
	});

	afterEach(() => {
		delete process.env[CONFIG_ENV];
	});

	it('prompts.dbPath moves the library file (~ expanded)', () => {
		writeSettings('prompts:\n  dbPath: ~/dsi-test-home/library/prompts.sqlite\n');
		const p = resolvePromptsDbPath();
		expect(p).toBe(join(homedir(), 'dsi-test-home/library/prompts.sqlite'));
	});

	it('an absolute dbPath is used verbatim', () => {
		writeSettings(`prompts:\n  dbPath: ${join(tmpRoot, 'other.sqlite')}\n`);
		expect(resolvePromptsDbPath()).toBe(join(tmpRoot, 'other.sqlite'));
	});

	it('a trailing separator marks a directory — the default filename lands inside', () => {
		writeSettings(`prompts:\n  dbPath: ${tmpRoot}/\n`);
		expect(resolvePromptsDbPath()).toBe(join(tmpRoot, 'prompts.sqlite'));
	});

	it('a blank or junk dbPath falls back to the default sibling', () => {
		writeSettings('prompts:\n  dbPath: "   "\n');
		expect(resolvePromptsDbPath().endsWith(join('.dsi', 'prompts.sqlite'))).toBe(true);

		writeSettings('prompts:\n  dbPath: [1, 2]\n');
		expect(resolvePromptsDbPath().endsWith(join('.dsi', 'prompts.sqlite'))).toBe(true);

		writeSettings('other:\n  key: 1\n');
		expect(resolvePromptsDbPath().endsWith(join('.dsi', 'prompts.sqlite'))).toBe(true);
	});

	it('env still wins over the config file (the test seam holds)', () => {
		writeSettings(`prompts:\n  dbPath: ${join(tmpRoot, 'from-config.sqlite')}\n`);
		process.env[PROMPTS_DB_ENV] = join(tmpRoot, 'from-env.sqlite');
		expect(resolvePromptsDbPath()).toBe(join(tmpRoot, 'from-env.sqlite'));
	});
});

// ── The Prompt Tags (ADR 2026-09-14, D1/D4/D7) — Wave 2 ────────────────────

describe('tags — createPrompt stores the normalized join (D1)', () => {
	it('normalizes: lowercase, dedupe, drop invalid, space-join', () => {
		const r = createPrompt('tagged probe', 'Tagged', ['Git', '+rca!', 'git', 'kb-writer'])!;
		if ('record' in r) expect(r.record.tags).toBe('git kb-writer'); // '+rca!' dropped
		else throw new Error('create failed');
	});

	it('no tags / empty array stores the empty string (untagged)', () => {
		const r = createPrompt('untagged probe');
		if ('record' in r) expect(r.record.tags).toBe('');
		else throw new Error('create failed');
		const r2 = createPrompt('untagged probe two', null, []);
		if ('record' in r2) expect(r2.record.tags).toBe('');
		else throw new Error('create failed');
	});
});

describe('listPrompts tags — padded LIKE AND semantics (D4)', () => {
	beforeEach(() => {
		createPrompt('commit all and push', 'commitmsg', ['git', 'rca']);
		createPrompt('study the github flow', 'github study', ['git', 'github']);
		createPrompt('path_with_underscores rule', null, ['code_review']);
		createPrompt('untagged legacy row', null);
	});

	it('AND semantics: only rows carrying EVERY word survive', () => {
		const { rows } = listPrompts({ tags: ['git', 'rca'] });
		expect(rows.map((r) => r.text)).toEqual(['commit all and push']);
	});

	it('git does NOT match github (padded LIKE, whole words only)', () => {
		const { rows } = listPrompts({ tags: ['git'] });
		expect(rows.map((r) => r.text).sort()).toEqual(['commit all and push', 'study the github flow']);
		const { rows: onlyGithub } = listPrompts({ tags: ['github'] });
		expect(onlyGithub.map((r) => r.text)).toEqual(['study the github flow']);
	});

	it('underscore is matched literally (code_review ≠ code review)', () => {
		const { rows } = listPrompts({ tags: ['code_review'] });
		expect(rows.map((r) => r.text)).toEqual(['path_with_underscores rule']);
		const { rows: spaced } = listPrompts({ tags: ['code review'] });
		expect(spaced).toEqual([]);
	});

	it('untagged rows are invisible to tag filters (by design)', () => {
		for (const tags of [['git'], ['code_review'], ['git', 'rca', 'github']]) {
			const { rows } = listPrompts({ tags });
			expect(rows.every((r) => r.tags !== '')).toBe(true);
		}
	});

	it('tags compose with q in one WHERE clause', () => {
		const { rows } = listPrompts({ tags: ['git'], q: 'commit' });
		expect(rows.map((r) => r.text)).toEqual(['commit all and push']);
		// q is a CONTAINS filter (2026-09-19) — a word matching no
		// substring of the tag-surviving rows is an honest miss.
		const { rows: miss } = listPrompts({ tags: ['git'], q: 'zzz' });
		expect(miss).toEqual([]);
	});

	it('total respects the tag filter', () => {
		expect(listPrompts({ tags: ['git'] }).total).toBe(2);
		expect(listPrompts({}).total).toBe(4);
	});
});

describe('countPromptUse — count-only (D7)', () => {
	it('known row → counted with use_count+1; row identity kept', () => {
		const created = createPrompt('counted probe', null, ['git']);
		if (!('record' in created)) throw new Error('create failed');
		const res = countPromptUse('counted probe');
		expect(res).not.toBeNull();
		if (res && 'record' in res) {
			expect(res.counted).toBe(true);
			expect(res.record.use_count).toBe(2);
			expect(res.record.tags).toBe('git');
		}
		expect(findPromptByText('counted probe')!.use_count).toBe(2);
	});

	it('unknown text → counted:false and NO insert (the upsert leg is dead)', () => {
		const before = listPrompts({}).total;
		const res = countPromptUse('never seen before text');
		expect(res).toEqual({ counted: false });
		expect(findPromptByText('never seen before text')).toBeNull();
		expect(listPrompts({}).total).toBe(before); // row count unchanged
	});

	it('blank text → null (failure), not a silent count', () => {
		expect(countPromptUse('   ')).toBeNull();
	});
});
