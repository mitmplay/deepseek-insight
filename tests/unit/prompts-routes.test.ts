/**
 * prompts-routes tests (Task 1.2-T) — the /api/prompts HTTP contracts,
 * invoked directly with node-env Request objects (a2a-routes.test.ts
 * pattern): both GET modes ({results} search vs {rows,total} manager),
 * param clamps, POST 201/409/400. Task 1.3-T extends this file with
 * PATCH/DELETE/use/autoAdd cases.
 *
 * Spec: dev/specs/2026-08-28 - DSI Suggest Strip (Tasks 1.2/1.2-T).
 * Runs against a seeded tmp DB via the DSI_PROMPTS_DB env seam.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	__resetPromptsDbCache,
	createPrompt,
	findPromptByText,
	listPrompts,
	openPromptsDb,
	PROMPTS_DB_ENV,
	recordPromptUse
} from '$lib/server/prompts/db.js';
// Route handlers via relative import — the established api-dsh.test.ts /
// a2a-routes.test.ts pattern ($lib aliases only cover src/lib).
import { GET, POST } from '../../src/routes/api/prompts/+server';
import { PATCH, DELETE } from '../../src/routes/api/prompts/[id]/+server';
import { POST as POST_USE } from '../../src/routes/api/prompts/use/+server';

let tmpRoot: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), 'dsi-prompts-routes-'));
	process.env[PROMPTS_DB_ENV] = join(tmpRoot, 'prompts.sqlite');
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

const BASE = 'http://localhost';

/** Minimal RequestEvent double — routes read only these members
 *  (the established api-dsh.test.ts mkEvent pattern). */
function mkEvent(e: Record<string, unknown>): never {
	return { setHeaders: () => {}, ...e } as never;
}

/** GET with query string → route (async wrapper: handlers are
 *  MaybePromise<Response>). */
async function get(path: string): Promise<Response> {
	return GET(mkEvent({ url: new URL(`${BASE}${path}`) }));
}

function seed(...texts: string[]): void {
	for (const t of texts) recordPromptUse(t);
}

describe('GET /api/prompts (Task 1.2-T)', () => {
	beforeEach(() => {
		seed('load project AIP, OCI', 'load weekly report', 'ship it to staging');
		// deterministic ranking: bump the first to top
		recordPromptUse('load project AIP, OCI');
		recordPromptUse('load project AIP, OCI');
	});

	it('search mode (default) returns { results } prefix-matched, ranked by uses', async () => {
		const res = await get('/api/prompts?q=load');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { results: { text: string; use_count: number }[] };
		expect(body.results.length).toBe(2);
		expect(body.results[0].text).toBe('load project AIP, OCI');
		expect(body.results[0].use_count).toBe(3);
	});

	it('mode=contains routes to tiered search (contains semantics)', async () => {
		const res = await get('/api/prompts?q=weekly&mode=contains');
		const body = (await res.json()) as { results: { text: string }[] };
		expect(body.results.map((r) => r.text)).toEqual(['load weekly report']);
	});

	it('unrecognized mode falls back to the prefix contract, never 500', async () => {
		const res = await get('/api/prompts?q=load&mode=bogus');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { results: { text: string }[] };
		expect(body.results.length).toBe(2);
	});

	it('limit clamps to 10 max; default 5; junk falls back to 5', async () => {
		for (let i = 0; i < 7; i++) seed(`clamp probe ${i}`);
		const bodyOf = async (path: string) =>
			((await (await get(path)).json()) as { results: unknown[] }).results.length;
		expect(await bodyOf('/api/prompts?q=clamp&limit=3')).toBe(3);
		expect(await bodyOf('/api/prompts?q=clamp&limit=999')).toBeLessThanOrEqual(10);
		expect(await bodyOf('/api/prompts?q=clamp')).toBe(5);
		expect(await bodyOf('/api/prompts?q=clamp&limit=abc')).toBe(5);
	});

	it('manager mode (sort present) returns { rows, total } with paging', async () => {
		const res = await get('/api/prompts?sort=uses&dir=asc&limit=2');
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			rows: { text: string; use_count: number }[];
			total: number;
		};
		expect(body.total).toBe(3); // fresh DB per test (beforeEach): only this test's 3 seeds
		expect(body.rows.length).toBe(2);
		// uses asc → the 1-use rows first
		expect(body.rows.every((r) => r.use_count === 1)).toBe(true);
	});

	it('manager mode limit clamps to 500; junk offset falls back to 0', async () => {
		const res = await get('/api/prompts?sort=uses&limit=99999');
		const body = (await res.json()) as { rows: unknown[] };
		expect(body.rows.length).toBeLessThanOrEqual(500);
		const res2 = await get('/api/prompts?sort=uses&offset=abc');
		expect(res2.status).toBe(200);
	});
});

/** POST with explicit params (path-variable routes) → route. */
async function postAt(
	route: (e: never) => unknown,
	params: Record<string, string>,
	payload: unknown
): Promise<Response> {
	return route(
		mkEvent({
			params,
			request: new Request(`${BASE}/api/prompts`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			})
		})
	) as Promise<Response>;
}

async function patchId(id: string, payload: unknown): Promise<Response> {
	return PATCH(
		mkEvent({
			params: { id },
			request: new Request(`${BASE}/api/prompts/${id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			})
		})
	);
}

async function deleteId(id: string): Promise<Response> {
	return DELETE(mkEvent({ params: { id } }));
}

describe('PATCH /api/prompts/[id] (Task 1.3-T)', () => {
	it('label-only rename → 200 (legacy path); unknown row → 409', async () => {
		const rec = recordPromptUse('patch me');
		const res = await patchId(String(rec!.id), { label: 'Renamed' });
		expect(res.status).toBe(200);
		expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
		expect(findPromptByText('patch me')?.label).toBe('Renamed');

		expect((await patchId('99999', { label: 'X' })).status).toBe(409);
	});

	it('label null clears the label', async () => {
		const rec = recordPromptUse('clear my label');
		rename_via_full_path: {
			const res = await patchId(String(rec!.id), { label: 'Temp' });
			expect(res.status).toBe(200);
		}
		const res2 = await patchId(String(rec!.id), { label: null });
		expect(res2.status).toBe(200);
		expect(findPromptByText('clear my label')?.label).toBeNull();
	});

	it('text/use_count present → full update path, use_count floored at 1', async () => {
		const rec = recordPromptUse('full update');
		recordPromptUse('full update');
		const res = await patchId(String(rec!.id), { text: 'full update v2', use_count: 0 });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { record: { text: string; use_count: number } };
		expect(body.record.text).toBe('full update v2');
		expect(body.record.use_count).toBe(1);
		expect(findPromptByText('full update')).toBeNull(); // old text gone
	});

	it('text collision with another row → 409', async () => {
		const a = recordPromptUse('collision target')!;
		const b = recordPromptUse('other row')!;
		const res = await patchId(String(b.id), { text: 'collision target' });
		expect(res.status).toBe(409);
	});

	it('invalid id / invalid body → 400', async () => {
		expect((await patchId('0', { label: 'x' })).status).toBe(400);
		expect((await patchId('abc', { label: 'x' })).status).toBe(400);
		const bad = PATCH(
			mkEvent({
				params: { id: '1' },
				request: new Request(BASE, { method: 'PATCH', body: 'not json' })
			})
		);
		expect((await bad).status).toBe(400);
		const badText = patchId('1', { text: 42 });
		expect((await badText).status).toBe(400);
		const badCount = patchId('1', { use_count: 'many' });
		expect((await badCount).status).toBe(400);
		const badLabel = patchId('1', { label: 7 });
		expect((await badLabel).status).toBe(400);
	});
});

describe('DELETE /api/prompts/[id] (Task 1.3-T)', () => {
	it('removes the row → 200 {ok}; second delete → 404; junk id → 400', async () => {
		const rec = recordPromptUse('delete me')!;
		expect((await deleteId(String(rec.id))).status).toBe(200);
		expect(findPromptByText('delete me')).toBeNull();
		expect((await deleteId(String(rec.id))).status).toBe(404);
		expect((await deleteId('xyz')).status).toBe(400);
	});
});

describe('POST /api/prompts/use — count-only (The Prompt Tags 2.3-T, ADR D7)', () => {
	it('known row → 200 {record} with use_count+1', async () => {
		seed('count me twice');
		const r1 = await postAt(POST_USE, {}, { text: 'count me twice' });
		expect(r1.status).toBe(200);
		const b1 = (await r1.json()) as { record: { use_count: number } };
		expect(b1.record.use_count).toBe(2);
		const r2 = await postAt(POST_USE, {}, { text: 'count me twice' });
		const b2 = (await r2.json()) as { record: { use_count: number } };
		expect(b2.record.use_count).toBe(3);
	});

	it('unknown text → 200 {counted:false} and NO row ever inserts (the autoAdd upsert leg is unreachable)', async () => {
		const before = listPrompts({}).total;
		const res = await postAt(POST_USE, {}, { text: 'unknown wire probe' });
		expect(res.status).toBe(200);
		expect((await res.json()) as { counted: boolean }).toEqual({ counted: false });
		expect(findPromptByText('unknown wire probe')).toBeNull();
		expect(listPrompts({}).total).toBe(before); // INSERT leg dead
	});

	it('invalid body → 400', async () => {
		expect((await postAt(POST_USE, {}, { text: '' })).status).toBe(400);
		expect((await postAt(POST_USE, {}, {})).status).toBe(400);
	});
});

describe('POST /api/prompts create (Task 1.2-T)', () => {
	it('creates with label → 201 + record', async () => {
		const res = await POST(
			mkEvent({
				request: new Request(`${BASE}/api/prompts`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ text: 'run alpha suite', label: 'Alpha' })
				})
			})
		);
		expect(res.status).toBe(201);
		const body = (await res.json()) as { record: { label: string | null; use_count: number } };
		expect(body.record.label).toBe('Alpha');
		expect(body.record.use_count).toBe(1);
	});

	it('duplicate text → 409 + the existing row, no count bump', async () => {
		seed('already here');
		const res = await POST(
			mkEvent({
				request: new Request(`${BASE}/api/prompts`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ text: 'already here' })
				})
			})
		);
		expect(res.status).toBe(409);
		const body = (await res.json()) as { existing: { text: string } };
		expect(body.existing.text).toBe('already here');
		const rows = listPrompts({});
		expect(rows.rows.find((r) => r.text === 'already here')?.use_count).toBe(1);
	});

	it('invalid body → 400 (missing text / blank / non-string / bad JSON)', async () => {
		const post = (payload: string) =>
			POST(
				mkEvent({
					request: new Request(`${BASE}/api/prompts`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: payload
					})
				})
			);
		expect((await post(JSON.stringify({}))).status).toBe(400);
		expect((await post(JSON.stringify({ text: '   ' }))).status).toBe(400);
		expect((await post(JSON.stringify({ text: 42 }))).status).toBe(400);
		expect((await post('not json')).status).toBe(400);
		expect((await post(JSON.stringify({ text: 'ok', label: 7 }))).status).toBe(400);
	});

	it('label null is accepted (clears)', async () => {
		const res = await POST(
			mkEvent({
				request: new Request(`${BASE}/api/prompts`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ text: 'labelless row', label: null })
				})
			})
		);
		expect(res.status).toBe(201);
		const body = (await res.json()) as { record: { label: string | null } };
		expect(body.record.label).toBeNull();
	});
});

// ── The Prompt Tags (ADR 2026-09-14) — Wave 2 wire contracts ───────────────

describe('GET /api/prompts manager mode — tags param (2.2-T)', () => {
	beforeEach(() => {
		createPrompt('commit all and push', 'commitmsg', ['git', 'rca']);
		createPrompt('study the github flow', null, ['git', 'github']);
		createPrompt('untagged legacy row', null);
	});

	it('tags=a,b filters AND; invalid words are dropped, never 500', async () => {
		const res = await get('/api/prompts?sort=uses&tags=git,rca');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { rows: { text: string }[]; total: number };
		expect(body.rows.map((r) => r.text)).toEqual(['commit all and push']);
		expect(body.total).toBe(1);

		const junk = await get('/api/prompts?sort=uses&tags=git,+bogus!');
		expect(junk.status).toBe(200);
		const junkBody = (await junk.json()) as { rows: { text: string }[] };
		expect(junkBody.rows.map((r) => r.text).sort()).toEqual(['commit all and push', 'study the github flow']);
	});

	it('a plus-free query is byte-identical to the old wire shape (no tags param change)', async () => {
		const res = await get('/api/prompts?sort=uses&q=commit');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { rows: { text: string; tags: string }[]; total: number };
		expect(body.total).toBe(1);
		expect(body.rows[0].text).toBe('commit all and push');
		expect(body.rows[0].tags).toBe('git rca'); // record now carries tags additively
	});
});

describe('POST /api/prompts — tags body (2.2-T)', () => {
	it('creates with tags → 201, stored normalized', async () => {
		const res = await POST(
			mkEvent({
				request: new Request(`${BASE}/api/prompts`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ text: 'tagged via wire', tags: ['Git', 'rca'] })
				})
			})
		);
		expect(res.status).toBe(201);
		const body = (await res.json()) as { record: { tags: string } };
		expect(body.record.tags).toBe('git rca');
	});

	it('additive: {text} alone still creates 201 untagged', async () => {
		const res = await POST(
			mkEvent({
				request: new Request(`${BASE}/api/prompts`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ text: 'stale client probe' })
				})
			})
		);
		expect(res.status).toBe(201);
		expect(((await res.json()) as { record: { tags: string } }).record.tags).toBe('');
	});

	it('invalid tag word → 400; non-array tags → 400', async () => {
		const post = (payload: unknown) =>
			POST(
				mkEvent({
					request: new Request(`${BASE}/api/prompts`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(payload)
					})
				})
			);
		expect((await post({ text: 'x', tags: ['bad word!'] })).status).toBe(400);
		expect((await post({ text: 'x', tags: ['ok', 42] })).status).toBe(400);
		expect((await post({ text: 'x', tags: 'git' })).status).toBe(400);
		expect(findPromptByText('x')).toBeNull(); // 400 precedes any insert
	});

	it('use_count/macro seed the create (Add-dialog alignment); bad types → 400, absent → defaults', async () => {
		const post = (payload: unknown) =>
			POST(
				mkEvent({
					request: new Request(`${BASE}/api/prompts`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(payload)
					})
				})
			);
		const ok = await post({ text: 'seeded via wire', use_count: 3, macro: true });
		expect(ok.status).toBe(201);
		const rec = ((await ok.json()) as { record: { use_count: number; macro: number } }).record;
		expect(rec.use_count).toBe(3);
		expect(rec.macro).toBe(1);

		expect((await post({ text: 'bad uses', use_count: '3' })).status).toBe(400);
		expect((await post({ text: 'bad macro', macro: 'yes' })).status).toBe(400);

		const stale = await post({ text: 'stale defaults probe' });
		expect(stale.status).toBe(201);
		const def = ((await stale.json()) as { record: { use_count: number; macro: number } }).record;
		expect(def.use_count).toBe(1);
		expect(def.macro).toBe(0);
	});
});
