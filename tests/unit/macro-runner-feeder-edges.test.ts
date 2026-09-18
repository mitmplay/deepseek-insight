/**
 * macro-runner — feeder-edge arms the main suite's runs miss.
 *
 * Pins: the held-step contract's refusal arms (feedNext outside held,
 * runAgain with no prior row, abort while idle), the ?-query failure
 * ladder (empty key, no shelf match, non-JSON search body), the
 * visited-skip for a row resolved twice in one run, the singular
 * "resolved: 1 section" note, and a command whose receipt rejects —
 * stopping the run with the reason on the sheet.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { macroRunner, macroRunState } from '$lib/services/chat/macro-runner.svelte';
import { resetAppConfigForTests } from '$lib/services/config/app-config.svelte';
import { registerAddPanel } from '$lib/services/panels/panel-registry';

const CTX = {
	sessionId: 'session-aaaa0000-0000-4000-8000-000000000001',
	workspace: '/w/proj',
	agent: 'main',
	panelId: 'p1'
};

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

/** Ordered fake-fetch routes; unmatched calls get a 404-shaped ok:false. */
function fakeFetch(
	routes: Array<{ test: (c: Call) => boolean; respond: (c: Call) => Response | Promise<Response> }>
) {
	const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const call = { url, init };
		for (const r of routes) if (r.test(call)) return r.respond(call);
		return jsonRes({ ok: false }, 404);
	});
	vi.stubGlobal('fetch', fn);
	return fn;
}

function searchRoute(body: unknown, status = 200) {
	return {
		test: (c: Call) => c.url.startsWith('/api/prompts?q='),
		respond: () => (status === 0 ? new Response('{not json', { status: 200 }) : jsonRes(body, status))
	};
}

const promptOk = {
	test: (c: Call) => /\/api\/dsh\/session\/[^/]+\/prompt$/.test(c.url),
	respond: () => jsonRes({ ok: true })
};

function drain(times = 40): Promise<void> {
	let p = Promise.resolve();
	for (let i = 0; i < times; i++) p = p.then(() => new Promise((r) => setTimeout(r, 0)));
	return p;
}

afterEach(() => {
	macroRunner.resetForTests();
	resetAppConfigForTests();
	registerAddPanel(null);
	vi.unstubAllGlobals();
});

function row(text: string, id = 300): { id: number; text: string } {
	return { id, text };
}

describe('macro-runner — refusal arms outside a live run', () => {
	it('feedNext outside a held run is a no-op (idle module state)', async () => {
		fakeFetch([]);
		macroRunner.resetForTests();
		await macroRunner.feedNext();
		expect(macroRunState().phase).toBe('idle');
	});

	it('runAgain with no prior row is a no-op', () => {
		fakeFetch([]);
		macroRunner.runAgain();
		expect(macroRunState().phase).toBe('idle');
	});

	it('abort while idle keeps the idle state (nothing to drop)', () => {
		fakeFetch([]);
		macroRunner.abort();
		expect(macroRunState().phase).toBe('idle');
		expect(macroRunState().note).toBeNull();
	});
});

describe('macro-runner — ?-query failure ladder', () => {
	it('a bare "?" (empty key) stops the run before any search fires', async () => {
		const fetchFn = fakeFetch([promptOk]);
		macroRunner.start(row('?\nhello'), CTX);
		await drain();
		const s = macroRunState();
		expect(s.phase).toBe('failed');
		expect(s.note).toContain('empty ? query');
		const query = s.lines[0]!;
		expect(query.isQuery).toBe(true);
		expect(query.state).toBe('failed');
		// the plain line after the query never fed
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('a search with no hits stops the run naming the key', async () => {
		fakeFetch([searchRoute({ results: [] })]);
		macroRunner.start(row('?ghost-topic'), CTX);
		await drain();
		const s = macroRunState();
		expect(s.phase).toBe('failed');
		expect(s.note).toBe('no shelf match for "ghost-topic" — stopping the run');
	});

	it('an ok search with a non-JSON body resolves no hit and stops the run', async () => {
		fakeFetch([searchRoute(undefined, 0)]);
		macroRunner.start(row('?broken-body'), CTX);
		await drain();
		const s = macroRunState();
		expect(s.phase).toBe('failed');
		expect(s.note).toBe('no shelf match for "broken-body" — stopping the run');
	});

	it('a hit resolving to a BLANK row stops the run (empty expansion)', async () => {
		fakeFetch([searchRoute({ results: [{ id: 7, text: '   ' }] })]);
		macroRunner.start(row('?empty-hit'), CTX);
		await drain();
		expect(macroRunState().phase).toBe('failed');
		expect(macroRunState().note).toBe('the matched row for "empty-hit" is empty');
	});
});

describe('macro-runner — ?-resolution success shapes', () => {
	it('a hit resolving ONE section reports the singular note and feeds the spliced child', async () => {
		let prompts = 0;
		fakeFetch([
			searchRoute({ results: [{ id: 8, text: 'one plain line' }] }),
			{
				test: promptOk.test,
				respond: () => {
					prompts += 1;
					return jsonRes({ ok: true });
				}
			}
		]);
		macroRunner.start(row('?single'), CTX);
		await drain();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		expect(s.lines[0]).toMatchObject({
			kind: 'query',
			state: 'queued',
			note: 'resolved: 1 section',
			isQuery: true
		});
		expect(s.lines).toHaveLength(2); // query row + its spliced send child
		expect(prompts).toBe(1); // the spliced line POSTed once
	});

	it('a hit already consumed in THIS run is skipped, and the run continues', async () => {
		fakeFetch([
			searchRoute({ results: [{ id: 9, text: 'shared line' }] }),
			promptOk
		]);
		// Both queries resolve to row 9 — the second is a visited-skip.
		macroRunner.start(row('?first\n?second'), CTX);
		await drain();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		// Feed order: query1 → its spliced send child → query2 (the skip).
		expect(s.lines[2]).toMatchObject({ kind: 'query', state: 'skipped', note: 'already in this run — skipped' });
		expect(s.lines[0]).toMatchObject({ kind: 'query', state: 'queued' });
	});
});

describe('macro-runner — held-step failure arms', () => {
	it('a step whose command receipt rejects stops the run (failed phase kept)', async () => {
		fakeFetch([
			{
				test: (c) => /\/permission$/.test(c.url),
				respond: () => jsonRes({ ok: false, error: { message: 'host refused' } }, 502)
			}
		]);
		macroRunner.start(row('/permission read-only'), CTX, { held: true });
		expect(macroRunState().phase).toBe('held');
		await macroRunner.feedNext();
		const s = macroRunState();
		expect(s.phase).toBe('failed');
		expect(s.lines[0]).toMatchObject({ kind: 'command', state: 'failed' });
		expect(s.note).toContain('host refused');
	});

	it('a step resolving a query leaves the run held while spliced children wait', async () => {
		fakeFetch([searchRoute({ results: [{ id: 11, text: 'later line' }] }), promptOk]);
		macroRunner.start(row('?step'), CTX, { held: true });
		await macroRunner.feedNext(); // the step = the search itself
		expect(macroRunState().phase).toBe('held'); // child still pending
		expect(macroRunState().total).toBe(2);
		await macroRunner.feedNext(); // now the spliced send
		expect(macroRunState().phase).toBe('fed');
	});
});
