/**
 * macro-runner tests (task 2.1-T, sectioned rewrite of 1.3-T): the
 * receipts-only SECTION feeder — routing by compiled kind (mention-block
 * / command / query / send-block), section coalescing (ONE POST per
 * block, newlines intact), empty-row refusal with zero fetches,
 * sequential receipts, /new sessionId handoff (two retargets), visited-
 * skip note, depth + section caps (a block counts once), abort/hold/step
 * over sections, run-again, one-run refusal, and record-via-executor
 * only for send sections.
 *
 * The line-grammar-pinned cases (blank-skip, plain-line POST, one /use)
 * were rewritten to section semantics in the same wave — the owned D15
 * break; the blank-only refusal at :128 survives verbatim.
 *
 * All fetches are fakes; no route truth is assumed beyond shapes the
 * executor contract already pins (command-executor.test.ts).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { macroRunner, macroRunState } from '$lib/services/chat/macro-runner.svelte';
import { resetAppConfigForTests } from '$lib/services/config/app-config.svelte';
import {
	registerAddPanel,
	registerReplacePanel
} from '$lib/services/panels/panel-registry';

const CTX = {
	sessionId: 'session-11111111-0000-4000-8000-000000000001',
	workspace: '/w/proj',
	agent: 'main',
	panelId: 'p1'
};
const NEW_SESSION = 'session-22222222-0000-4000-8000-000000000002';

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

interface Call {
	url: string;
	init?: RequestInit;
}

/**
 * Fake fetch: route list matched in order; every call recorded. Default
 * answer for unmatched routes: ok 404-shaped body (never throws).
 */
function fakeFetch(
	routes: Array<{ test: (c: Call) => boolean; respond: (c: Call) => Response | Promise<Response> }>
) {
	const calls: Call[] = [];
	const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const call = { url, init };
		calls.push(call);
		for (const r of routes) {
			if (r.test(call)) return r.respond(call);
		}
		return jsonRes({ ok: false }, 404);
	});
	vi.stubGlobal('fetch', fn);
	return { calls, fn };
}

function promptRoute(opts: { ok?: boolean } = {}) {
	return {
		test: (c: Call) => /\/api\/dsh\/session\/[^/]+\/prompt$/.test(c.url) && c.init?.method === 'POST',
		respond: () => (opts.ok === false ? jsonRes({ ok: false, error: { message: 'agent-busy' } }, 502) : jsonRes({ ok: true }))
	};
}

function searchRoute(rows: Array<{ id: number; text: string }>) {
	return {
		test: (c: Call) => c.url.startsWith('/api/prompts?q='),
		respond: () =>
			jsonRes({
				results: rows.map((r) => ({
					id: r.id,
					label: null,
					text: r.text,
					use_count: 1,
					last_used_at: '2026-08-29T00:00:00.000Z'
				}))
			})
	};
}

/** The /new happy route: create + swap handlers. */
function newSessionRoute() {
	registerReplacePanel(() => true);
	return {
		test: (c: Call) => c.url.endsWith('/api/dsh/sessions') && c.init?.method === 'POST',
		respond: () => jsonRes({ ok: true, sessionId: NEW_SESSION })
	};
}

/** /permission route: host-side execute, ok text back. */
function permissionRoute() {
	return {
		test: (c: Call) => /\/permission$/.test(c.url) && c.init?.method === 'POST',
		respond: () => jsonRes({ ok: true, text: 'permission updated' })
	};
}

/** /new route minting DISTINCT successor ids per call (two-retarget rows). */
function newSessionSeqRoute(ids: string[]) {
	registerReplacePanel(() => true);
	let n = 0;
	return {
		test: (c: Call) => c.url.endsWith('/api/dsh/sessions') && c.init?.method === 'POST',
		respond: () => jsonRes({ ok: true, sessionId: ids[Math.min(n++, ids.length - 1)] })
	};
}

function drain(times = 40): Promise<void> {
	// macrotask pump — every await in the feeder resolves within a few ticks
	let p = Promise.resolve();
	for (let i = 0; i < times; i++) p = p.then(() => new Promise((r) => setTimeout(r, 0)));
	return p;
}

async function settle(): Promise<void> {
	await drain();
	await drain();
}

afterEach(() => {
	macroRunner.resetForTests();
	resetAppConfigForTests();
	registerAddPanel(null);
	registerReplacePanel(null);
	vi.unstubAllGlobals();
});

function row(text: string, id = 100): { id: number; text: string } {
	return { id, text };
}

// ── start: refusals ─────────────────────────────────────────────────────

describe('macro-runner — start refusals', () => {
	it('empty row text: refused, no fetch fires (Karpathy L2-Q4)', async () => {
		const { calls } = fakeFetch([]);
		const s = macroRunner.start(row('   \n  \n'), CTX);
		expect(s.phase).toBe('failed');
		expect(s.note).toContain('empty');
		expect(calls).toHaveLength(0);
	});

	it('blank-only lines are dropped; all-blank row refused', async () => {
		const { calls } = fakeFetch([]);
		const s = macroRunner.start(row('\n\n'), CTX);
		expect(s.phase).toBe('failed');
		expect(calls).toHaveLength(0);
	});

	it('over-cap row refused at start with the cap named (sections counted)', async () => {
		const { calls } = fakeFetch([]);
		// 26 one-line SECTIONS (commands do not coalesce); held seeds no fetch.
		const text = Array.from({ length: 26 }, (_, i) => `/permission p${i + 1}`).join('\n');
		const s = macroRunner.start(row(text), CTX, { held: true });
		expect(s.phase).toBe('failed');
		expect(s.note).toContain('too many lines: 26 (max 25)');
		expect(calls).toHaveLength(0);
	});

	it('a block counts as ONE section — a 50-line wall of text is admitted', async () => {
		const { calls } = fakeFetch([]);
		const wall = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
		const s = macroRunner.start(row(wall), CTX, { held: true });
		expect(s.phase).toBe('held'); // 1 section ≤ 25 — the cap counts sections
		expect(s.total).toBe(1);
		expect(calls).toHaveLength(0);
	});

	it('second start while a run is live: refused with a visible note', async () => {
		const { calls } = fakeFetch([promptRoute()]);
		// 2 sections: a command one-liner + a send block (held — nothing feeds)
		macroRunner.start(row('/permission\nplain block'), CTX, { held: true }); // stays live
		await settle();
		const second = macroRunner.start(row('again'), CTX);
		expect(second.note).toContain('already running');
		// The live run is untouched — same sections, still held.
		expect(second.phase).toBe('held');
		expect(second.total).toBe(2);
	});
});

// ── line routing ────────────────────────────────────────────────────────

describe('macro-runner — line routing', () => {
	it('plain line → prompt POST (queue-mode receipt), no /use from the runner (sendPrompt owns it)', async () => {
		const { calls } = fakeFetch([promptRoute()]);
		macroRunner.start(row('hello world'), CTX);
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		expect(s.lines[0].state).toBe('queued');
		expect(s.lines[0].kind).toBe('send');
		const post = calls.find((c) => /\/prompt$/.test(c.url))!;
		expect(post.url).toContain(CTX.sessionId);
		expect(JSON.parse(String(post.init!.body))).toEqual({ text: 'hello world' });
	});

	it('plain lines coalesce — ONE POST, the interior blank rides along verbatim (D15)', async () => {
		const { calls } = fakeFetch([promptRoute()]);
		macroRunner.start(row('one\n\n   \ntwo'), CTX);
		await settle();
		const s = macroRunState();
		expect(s.total).toBe(1); // one send-block section
		expect(s.lines[0].kind).toBe('send');
		expect(s.lines[0].display).toBe('one');
		expect(s.lines[0].lineCount).toBe(4); // one, blank, blank(from '   '), two
		const posts = calls.filter((c) => /\/prompt$/.test(c.url));
		expect(posts).toHaveLength(1); // never line-per-line
		expect(JSON.parse(String(posts[0].init!.body)).text).toBe('one\n\n\ntwo');
	});

	it('/new line: create POST + swap, later lines land in the NEW session (sessionId handoff)', async () => {
		const { calls } = fakeFetch([newSessionRoute(), promptRoute()]);
		macroRunner.start(row('/new @code\nfirst prompt in the successor'), CTX);
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		// create carried cwd + preset override
		const create = calls.find((c) => c.url.endsWith('/api/dsh/sessions') && c.init?.method === 'POST')!;
		expect(JSON.parse(String(create.init!.body))).toEqual({ cwd: '/w/proj', agentPreset: 'code' });
		// the successor line landed in the NEW session (handoff)
		const post = calls.find((c) => /\/prompt$/.test(c.url))!;
		expect(post.url).toContain(NEW_SESSION);
		expect(JSON.parse(String(post.init!.body))).toEqual({ text: 'first prompt in the successor' });
		const newRec = s.lines[0];
		expect(newRec.note).toContain('new session');
	});
	it('/new @agent --add line: the --add flag survives the section feed — ADD handler runs (keepSelection), successor lines still retarget', async () => {
		const adds: unknown[] = [];
		registerAddPanel((req) => {
			adds.push(req);
			return true;
		});
		const { calls } = fakeFetch([newSessionRoute(), promptRoute()]);
		macroRunner.start(row('/new @app-dev --add\nfirst prompt in the added panel'), CTX);
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		expect(adds).toHaveLength(1);
		expect(adds[0]).toMatchObject({
			sessionId: NEW_SESSION,
			agentPreset: 'app-dev',
			afterSessionId: CTX.sessionId,
			keepSelection: true
		});
		// the create carried the @agent override verbatim
		const create = calls.find((c) => c.url.endsWith('/api/dsh/sessions') && c.init?.method === 'POST')!;
		expect(JSON.parse(String(create.init!.body))).toEqual({ cwd: '/w/proj', agentPreset: 'app-dev' });
		// later sections still land in the successor (the run retargets)
		const post = calls.find((c) => /\/prompt$/.test(c.url))!;
		expect(post.url).toContain(NEW_SESSION);
		expect(s.lines[0].note).toContain('new session');
	});

	it('? section: top hit COMPILES, its sections splice in order (one block = one section)', async () => {
		const { calls } = fakeFetch([
			newSessionRoute(),
			searchRoute([{ id: 55, text: 'list all oci containers\nthen prune them' }]),
			promptRoute()
		]);
		macroRunner.start(row('/new @code\n?oci'), CTX);
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		// search used contains mode
		const search = calls.find((c) => c.url.startsWith('/api/prompts?q='))!;
		expect(search.url).toContain('mode=contains');
		expect(decodeURIComponent(search.url)).toContain('q=oci');
		// the resolved block POSTs ONCE — both lines, newline intact, to NEW
		const posts = calls.filter((c) => /\/prompt$/.test(c.url));
		expect(posts).toHaveLength(1);
		expect(posts[0].url).toContain(NEW_SESSION);
		expect(JSON.parse(String(posts[0].init!.body)).text).toBe(
			'list all oci containers\nthen prune them'
		);
		// record shape: command + query + ONE spliced send section
		expect(s.lines[1].isQuery).toBe(true);
		expect(s.lines[1].kind).toBe('query');
		expect(s.lines[1].note).toContain('resolved: 1 section');
		expect(s.lines[2].kind).toBe('send');
		expect(s.lines[2].lineCount).toBe(2);
		expect(s.lines.map((l) => l.display)).toEqual([
			'/new @code',
			'?oci',
			'list all oci containers'
		]);
	});

	it('? line resolving to the RUNNING row: visited-skip with note', async () => {
		const { calls } = fakeFetch([
			searchRoute([{ id: 100, text: 'irrelevant' }]), // id 100 = the running row's id
			promptRoute()
		]);
		macroRunner.start(row('?self'), CTX);
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		expect(s.lines[0].state).toBe('skipped');
		expect(s.lines[0].note).toContain('already in this run');
		expect(calls.filter((c) => /\/prompt$/.test(c.url))).toHaveLength(0);
	});

	it('? line resolving to an ALREADY-EXPANDED row mid-run: skipped, no re-expansion', async () => {
		const { calls } = fakeFetch([
			searchRoute([
				{ id: 55, text: 'alpha' },
				{ id: 55, text: 'alpha' }
			]),
			promptRoute()
		]);
		// ?a → alpha (expanded, visited 55); ?b → also 55 → skipped
		macroRunner.start(row('?a\n?b'), CTX);
		await settle();
		const s = macroRunState();
		const skipRec = s.lines.find((l) => l.display === '?b')!;
		expect(skipRec.state).toBe('skipped');
		expect(s.phase).toBe('fed');
	});

	it('empty ? search results: fail-loud stop, run failed with the query named', async () => {
		const { calls } = fakeFetch([
			searchRoute([]),
			promptRoute()
		]);
		macroRunner.start(row('?nothing\nnever-reached'), CTX);
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('failed');
		expect(s.note).toContain('no shelf match for "nothing"');
		expect(s.lines[0].state).toBe('failed');
		// the second line never fired
		expect(calls.filter((c) => /\/prompt$/.test(c.url))).toHaveLength(0);
	});

	it('the MOTIVATING 3-section row: mention message delivered joined; ONE block POST verbatim', async () => {
		const TARGET = 'session-1d15d442-94bc-422c-afb1-e870db9906a3';
		registerAddPanel(() => true);
		const { calls } = fakeFetch([
			{
				test: (c) => c.url.endsWith('/api/dsh/sessions') && c.init?.method !== 'POST',
				respond: () =>
					jsonRes({
						ok: true,
						sessions: [
							{ sessionId: TARGET, title: 'TE-LO-LET', agentPreset: 'main', running: false, turns: 3 }
						]
					})
			},
			newSessionRoute(),
			{
				test: (c) => c.url.endsWith('/api/a2a/register'),
				respond: () => jsonRes({ ok: true })
			},
			promptRoute()
		]);
		// 3 sections: mention+2-line message · send-block of 3 bullets · /new
		const rowText = [
			'@session-1d15d442-94bc-422c-afb1-e870db9906a3 can you check the build?',
			'the tests on the CI node keep flaking',
			'',
			'- load project AIP',
			'- run the containers',
			'- prune them after',
			'',
			'/new @code'
		].join('\n');
		macroRunner.start(row(rowText), CTX);
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		expect(s.total).toBe(3);
		expect(s.lines.map((l) => l.kind)).toEqual(['mention', 'send', 'command']);
		// mention POST carries the JOINED two-line message (newline intact)
		const posts = calls.filter((c) => /\/prompt$/.test(c.url));
		expect(posts).toHaveLength(2); // mention delivery + ONE block POST
		expect(posts[0].url).toContain('1d15d442');
		expect(JSON.parse(String(posts[0].init!.body)).text).toContain(
			'can you check the build?\nthe tests on the CI node keep flaking'
		);
		// the block POSTs ONCE, bullets verbatim, newlines intact — to SELF
		expect(posts[1].url).toContain(CTX.sessionId);
		expect(JSON.parse(String(posts[1].init!.body)).text).toBe(
			'- load project AIP\n- run the containers\n- prune them after'
		);
		// sheet record: the block's display is its first line, +2 lines
		expect(s.lines[1].display).toBe('- load project AIP');
		expect(s.lines[1].lineCount).toBe(3);
		expect(s.lines[1].sendText).toBe(
			'- load project AIP\n- run the containers\n- prune them after'
		);
	});

	it('the 4-SECTION journey row: two retargets, the block lands in the FIRST new session', async () => {
		const TARGET = 'session-1d15d442-94bc-422c-afb1-e870db9906a3';
		const APP_DEV = 'session-33333333-0000-4000-8000-000000000003';
		const CODE = 'session-44444444-0000-4000-8000-000000000004';
		registerAddPanel(() => true);
		const { calls } = fakeFetch([
			{
				test: (c) => c.url.endsWith('/api/dsh/sessions') && c.init?.method !== 'POST',
				respond: () =>
					jsonRes({
						ok: true,
						sessions: [
							{ sessionId: TARGET, title: 'TE-LO-LET', agentPreset: 'main', running: false, turns: 3 }
						]
					})
			},
			newSessionSeqRoute([APP_DEV, CODE]),
			{
				test: (c) => c.url.endsWith('/api/a2a/register'),
				respond: () => jsonRes({ ok: true })
			},
			promptRoute()
		]);
		const rowText = [
			'',
			'@session-1d15d442-94bc-422c-afb1-e870db9906a3 can you check the build?',
			'the tests on the CI node keep flaking',
			'',
			'/new @app-dev',
			'- load project AIP',
			'- run the containers',
			'- prune them after',
			'/new @code',
			''
		].join('\n');
		macroRunner.start(row(rowText), CTX);
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		expect(s.total).toBe(4); // mention · /new · block · /new
		expect(s.lines.map((l) => l.kind)).toEqual(['mention', 'command', 'send', 'command']);
		// TWO sessions POSTs, presets app-dev then code
		const creates = calls.filter((c) => c.url.endsWith('/api/dsh/sessions') && c.init?.method === 'POST');
		expect(creates).toHaveLength(2);
		expect(JSON.parse(String(creates[0].init!.body))).toEqual({ cwd: '/w/proj', agentPreset: 'app-dev' });
		expect(JSON.parse(String(creates[1].init!.body))).toEqual({ cwd: '/w/proj', agentPreset: 'code' });
		// the block landed in the FIRST new session (app-dev), not the last
		const block = calls
			.filter((c) => /\/prompt$/.test(c.url))
			.find((c) => c.url.includes(APP_DEV))!;
		expect(block).toBeDefined();
		expect(JSON.parse(String(block.init!.body)).text).toBe(
			'- load project AIP\n- run the containers\n- prune them after'
		);
		// ownership ended on the LAST retarget (code), baseline reset
		expect(s.targetSessionId).toBe(CODE);
		expect(s.baselineTurns).toBe(0);
	});

	it('bare mention at EOF: kept as a section, fails LOUD with the executor usage note', async () => {
		const { calls } = fakeFetch([]);
		macroRunner.start(row('@session-1d15d442-94bc-422c-afb1-e870db9906a3'), CTX);
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('failed');
		expect(s.note).toContain('usage: @<session-id> <message>');
		expect(s.lines[0].kind).toBe('mention');
		expect(s.lines[0].state).toBe('failed');
		// nothing was ever delivered
		expect(calls.filter((c) => /\/prompt$/.test(c.url))).toHaveLength(0);
	});

	it('mention line routes through the executor (panel open + queue + register)', async () => {
		const TARGET = 'session-1d15d442-94bc-422c-afb1-e870db9906a3';
		registerAddPanel(() => true);
		const { calls } = fakeFetch([
			{
				test: (c) => c.url.endsWith('/api/dsh/sessions') && c.init?.method !== 'POST',
				respond: () =>
					jsonRes({
						ok: true,
						sessions: [
							{
								sessionId: TARGET,
								title: 'TE-LO-LET',
								agentPreset: 'main',
								running: false,
								turns: 3
							}
						]
					})
			},
			{
				test: (c) => c.url.endsWith('/api/a2a/register'),
				respond: () => jsonRes({ ok: true })
			},
			promptRoute()
		]);
		macroRunner.start(row(`@session-1d15d442-94bc-422c-afb1-e870db9906a3 check the build`), CTX);
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		expect(s.lines[0].state).toBe('queued');
		expect(s.lines[0].note).toContain('sent to TE-LO-LET');
		// delivered to the TARGET, not self
		const post = calls.find((c) => /\/prompt$/.test(c.url))!;
		expect(post.url).toContain('1d15d442');
	});
});

// ── sequential receipts ─────────────────────────────────────────────────

describe('macro-runner — sequential receipts (never a turn wait)', () => {
	it('section N+1 POSTs only after section N receipt resolves', async () => {
		let releaseFirst: ((r: Response) => void) | null = null;
		const { calls } = fakeFetch([
			permissionRoute(),
			{
				test: (c) => /\/prompt$/.test(c.url),
				respond: () => {
					return new Promise<Response>((resolve) => {
						releaseFirst = resolve;
					});
				}
			}
		]);
		// 3 sections: block · command · block — the second block's POST must
		// wait for the first block's receipt (sequential by construction).
		macroRunner.start(row('first block\n/permission\nsecond block'), CTX);
		await settle();
		// only ONE prompt POST so far — the second block awaits the receipt
		expect(calls.filter((c) => /\/prompt$/.test(c.url))).toHaveLength(1);
		releaseFirst!(jsonRes({ ok: true }));
		await settle();
		expect(calls.filter((c) => /\/prompt$/.test(c.url))).toHaveLength(2);
	});

	it('rejected receipt (agent-busy): fail-loud stop, later lines never fire', async () => {
		const { calls } = fakeFetch([promptRoute({ ok: false })]);
		macroRunner.start(row('first\nsecond'), CTX);
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('failed');
		expect(s.note).toContain('prompt rejected');
		expect(s.lines[0].state).toBe('failed');
		expect(calls.filter((c) => /\/prompt$/.test(c.url))).toHaveLength(1);
	});
});

// ── caps ────────────────────────────────────────────────────────────────

describe('macro-runner — caps (chat.macro)', () => {
	it('depth cap: nested ? beyond maxDepth stops fail-loud', async () => {
		// ?a → row 55 (?b) → row 56 (?c) → row 57 (text): the 4th expansion
		// would run at depth 3 = maxDepth → fail-loud before the fetch.
		const { calls } = fakeFetch([
			{
				test: (c) => c.url.startsWith('/api/prompts?q='),
				respond: (c) => {
					const q = decodeURIComponent(c.url.split('q=')[1].split('&')[0]);
					if (q === 'a') return jsonRes({ results: [shelf(55, '?b')] });
					if (q === 'b') return jsonRes({ results: [shelf(56, '?c')] });
					if (q === 'c') return jsonRes({ results: [shelf(57, '?d')] });
					return jsonRes({ results: [shelf(58, 'deep text')] });
				}
			},
			promptRoute()
		]);
		macroRunner.start(row('?a'), CTX);
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('failed');
		expect(s.note).toContain('depth cap');
	});

	it('section cap: expansion past maxLines stops fail-loud with the cap named', async () => {
		// 26 one-line COMMAND sections in the hit — sections, not lines
		const big = Array.from({ length: 26 }, (_, i) => `/permission p${i}`).join('\n');
		const { calls } = fakeFetch([searchRoute([{ id: 9, text: big }]), permissionRoute()]);
		macroRunner.start(row('?big'), CTX);
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('failed');
		expect(s.note).toContain('line cap');
		expect(calls.filter((c) => /\/permission$/.test(c.url))).toHaveLength(0);
	});

	it('send-block at the maxLines boundary: 25-line block admitted, ONE POST', async () => {
		const { calls } = fakeFetch([promptRoute()]);
		const wall = Array.from({ length: 25 }, (_, i) => `l${i}`).join('\n');
		macroRunner.start(row(wall), CTX);
		await settle();
		expect(macroRunState().phase).toBe('fed');
		const posts = calls.filter((c) => /\/prompt$/.test(c.url));
		expect(posts).toHaveLength(1);
		expect(JSON.parse(String(posts[0].init!.body)).text.split('\n')).toHaveLength(25);
	});

	it('fallback caps: 25 sections admitted, 26 refused (chat.macro lands in W3 3.2)', async () => {
		const { calls } = fakeFetch([permissionRoute()]);
		const okText = Array.from({ length: 25 }, (_, i) => `/permission p${i}`).join('\n');
		macroRunner.start(row(okText), CTX);
		await settle();
		expect(macroRunState().phase).toBe('fed');
		expect(calls.filter((c) => /\/permission$/.test(c.url))).toHaveLength(25);
		macroRunner.resetForTests();
		const tooMany = Array.from({ length: 26 }, (_, i) => `/permission p${i}`).join('\n');
		const refused = macroRunner.start(row(tooMany), CTX, { held: true });
		expect(refused.phase).toBe('failed');
		expect(refused.note).toContain('max 25');
	});
});

function shelf(id: number, text: string) {
	return { id, label: null, text, use_count: 1, last_used_at: '2026-08-29T00:00:00.000Z' };
}

// ── hold / step / resume / abort / run-again ────────────────────────────

describe('macro-runner — hold, step, resume, abort, run-again', () => {
	it('held start feeds NOTHING (zero fetches) until released', async () => {
		const { calls } = fakeFetch([promptRoute()]);
		macroRunner.start(row('one\ntwo'), CTX, { held: true });
		await settle();
		expect(macroRunState().phase).toBe('held');
		expect(calls).toHaveLength(0);
	});

	it('feedNext submits exactly ONE section, stays held, then runAll drains', async () => {
		const { calls } = fakeFetch([promptRoute(), permissionRoute()]);
		// 3 sections: block, command, block
		macroRunner.start(row('one\n/permission\ntwo'), CTX, { held: true });
		await settle();
		await macroRunner.feedNext();
		await settle();
		expect(calls.filter((c) => /\/prompt$/.test(c.url))).toHaveLength(1);
		expect(macroRunState().phase).toBe('held');
		await macroRunner.feedNext();
		await settle();
		expect(calls.filter((c) => /\/permission$/.test(c.url))).toHaveLength(1);
		await macroRunner.runAll();
		await settle();
		expect(macroRunState().phase).toBe('fed');
		expect(calls.filter((c) => /\/prompt$/.test(c.url))).toHaveLength(2);
	});

	it('abort drops unfed sections whole; the run reports stopped with the note', async () => {
		const { calls } = fakeFetch([promptRoute(), permissionRoute()]);
		macroRunner.start(row('one\n/permission\ntwo'), CTX, { held: true });
		await macroRunner.feedNext();
		await settle();
		macroRunner.abort();
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('stopped');
		expect(s.note).toContain('aborted');
		expect(calls.filter((c) => /\/prompt$/.test(c.url))).toHaveLength(1);
		// the aborted block NEVER partially posted — whole sections drop
		expect(calls.filter((c) => /\/permission$/.test(c.url))).toHaveLength(0);
		// feedNext after abort is a no-op
		await macroRunner.feedNext();
		expect(calls.filter((c) => /\/prompt$/.test(c.url))).toHaveLength(1);
	});

	it('runAgain replays the same row from scratch (fresh state, fresh fetches)', async () => {
		const { calls } = fakeFetch([promptRoute()]);
		macroRunner.start(row('hello'), CTX);
		await settle();
		expect(macroRunState().phase).toBe('fed');
		macroRunner.runAgain();
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		expect(s.lines).toHaveLength(1);
		expect(calls.filter((c) => /\/prompt$/.test(c.url))).toHaveLength(2);
	});

	it('runAgain refuses while a run is live', async () => {
		fakeFetch([promptRoute()]);
		macroRunner.start(row('/permission\nplain block'), CTX, { held: true });
		macroRunner.runAgain(); // no-op: run live
		await settle();
		expect(macroRunState().phase).toBe('held');
		expect(macroRunState().total).toBe(2);
	});
});

// ── record guard (via executor only) ────────────────────────────────────

describe('macro-runner — /use records only for plain lines (via sendPrompt)', () => {
	it('a plain send section records exactly one /use; command and ? sections never do', async () => {
		const { calls } = fakeFetch([
			newSessionRoute(),
			searchRoute([{ id: 55, text: 'oci list' }]),
			promptRoute(),
			{
				test: (c) => c.url.endsWith('/api/prompts/use'),
				respond: () => jsonRes({ ok: true })
			}
		]);
		macroRunner.start(row('/new\n?oci\nplain line'), CTX);
		await settle();
		await new Promise((r) => setTimeout(r, 10)); // fire-and-forget flush
		const uses = calls.filter((c) => c.url.endsWith('/api/prompts/use'));
		// sendPrompt records for: the 'plain line' block AND the resolved 'oci list'
		expect(uses).toHaveLength(2);
		expect(uses.map((u) => JSON.parse(String(u.init!.body)).text)).toEqual([
			'oci list',
			'plain line'
		]);
	});
});

// ── chip ownership follows the target session (2026-08-29 addendum) ─────

describe('macro-runner — ownership follows the target session', () => {
	it('start records the starting session and the panel-supplied baseline', async () => {
		fakeFetch([promptRoute()]);
		macroRunner.start(row('plain line'), CTX, { baselineTurns: 7 });
		const s = macroRunState();
		expect(s.targetSessionId).toBe(CTX.sessionId);
		expect(s.baselineTurns).toBe(7);
	});

	it('the /new handoff retargets the session and resets the baseline to 0', async () => {
		fakeFetch([
			newSessionRoute(),
			searchRoute([{ id: 55, text: 'list all oci containers' }]),
			promptRoute()
		]);
		macroRunner.start(row('/new @code\n?oci'), CTX, { baselineTurns: 7 });
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		expect(s.targetSessionId).toBe(NEW_SESSION);
		expect(s.baselineTurns).toBe(0);
	});

	it('runAgain re-baselines from the calling panel', async () => {
		fakeFetch([promptRoute()]);
		macroRunner.start(row('plain line'), CTX, { baselineTurns: 7 });
		await settle();
		expect(macroRunState().phase).toBe('fed');
		macroRunner.runAgain({ baselineTurns: 4 });
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		expect(s.targetSessionId).toBe(CTX.sessionId);
		expect(s.baselineTurns).toBe(4);
	});
});
