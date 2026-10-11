/**
 * macro-runner margin tests — lifecycle arms the main suites leave thin:
 * dismiss() guards (live-run refusal, ended-run dismissal, idle no-op),
 * feedNext on a drained held run, runAll outside held mode, abort after
 * fed, negative-cap fallback arms, and the non-ok search fetch arm.
 * Reuses the main suite's fake-fetch harness shapes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { macroRunner, macroRunState } from '$lib/services/chat/macro-runner.svelte';
import { resetAppConfigForTests } from '$lib/services/config/app-config.svelte';
import { registerAddPanel } from '$lib/services/panels/panel-registry';

const CTX = {
	sessionId: 'session-11111111-0000-4000-8000-000000000001',
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

function promptRoute(opts: { ok?: boolean } = {}) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : String(input);
		if (/\/prompt$/.test(url) && init?.method === 'POST') {
			return opts.ok === false
				? jsonRes({ ok: false, error: { message: 'busy' } }, 502)
				: jsonRes({ ok: true });
		}
		if (url.startsWith('/api/prompts?q=')) {
			return jsonRes({ results: [{ id: 201, label: null, text: 'one plain line', use_count: 1, last_used_at: 'x' }] });
		}
		return jsonRes({ ok: false }, 404);
	});
}

async function settle(): Promise<void> {
	for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
	macroRunner.resetForTests();
	resetAppConfigForTests();
	registerAddPanel(null);
	vi.unstubAllGlobals();
});

describe('macro-runner margins — dismiss guards', () => {
	it('dismiss during a live (held) run is refused — the sheet stays', async () => {
		vi.stubGlobal('fetch', promptRoute());
		macroRunner.start({ id: 100, text: 'line one' }, CTX, { held: true });
		expect(macroRunState().phase).toBe('held');
		macroRunner.dismiss();
		expect(macroRunState().phase).toBe('held'); // untouched
	});

	it('dismiss on an ended (failed) run resets to idle', async () => {
		vi.stubGlobal('fetch', promptRoute({ ok: false }));
		macroRunner.start({ id: 100, text: 'line one' }, CTX);
		await settle();
		expect(macroRunState().phase).toBe('failed');
		macroRunner.dismiss();
		expect(macroRunState().phase).toBe('idle');
	});

	it('dismiss while idle is a no-op (state stays idle)', () => {
		macroRunner.dismiss();
		expect(macroRunState().phase).toBe('idle');
	});
});

describe('macro-runner margins — held/drain edges', () => {
	it('feedNext on a held single-section run: the last receipt completes the run (fed)', async () => {
		vi.stubGlobal('fetch', promptRoute());
		macroRunner.start({ id: 100, text: 'line one\nline two' }, CTX, { held: true });
		expect(macroRunState().phase).toBe('held');
		// One feedNext feeds ONE section; with only one section queued the
		// receipt lands immediately and the run completes (source: 'the last
		// section's receipt landed' → fed, never back to held).
		await macroRunner.feedNext();
		expect(macroRunState().phase).toBe('fed');
	});

	it('runAll outside held mode is a no-op (idle module state)', async () => {
		await macroRunner.runAll();
		expect(macroRunState().phase).toBe('idle');
	});

	it('abort after fed keeps the fed phase (only unfed drops stop)', async () => {
		vi.stubGlobal('fetch', promptRoute());
		macroRunner.start({ id: 100, text: 'line one' }, CTX);
		await settle();
		expect(macroRunState().phase).toBe('fed');
		macroRunner.abort();
		expect(macroRunState().phase).toBe('fed');
	});
});

// NOTE (caps fallback arms): the num() junk-guards in caps() are unreachable
// through the public seam — app-config clamps maxLines/maxDepth before they
// reach the runner (pinned by app-config.test.ts 'clamps out-of-range values').
// There is no setAppConfigForTests; do not re-add a setter-based test here.

describe('macro-runner margins — query fetch failure arms', () => {
	it('a non-ok search response resolves no hit and stops the run', async () => {
		const fn = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : String(input);
			if (url.startsWith('/api/prompts?q=')) return jsonRes({}, 500);
			return jsonRes({ ok: false }, 404);
		});
		vi.stubGlobal('fetch', fn);
		macroRunner.start({ id: 100, text: '?missing' }, CTX);
		await settle();
		const st = macroRunState();
		expect(st.phase).toBe('failed');
		expect(st.note).toContain('no shelf match');
	});

	it('a rejecting search fetch stops the run with the query named', async () => {
		const fn = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : String(input);
			if (url.startsWith('/api/prompts?q=')) throw new Error('network down');
			return jsonRes({ ok: false }, 404);
		});
		vi.stubGlobal('fetch', fn);
		macroRunner.start({ id: 100, text: '?boom' }, CTX);
		await settle();
		const st = macroRunState();
		expect(st.phase).toBe('failed');
		expect(st.note).toContain('no shelf match for "boom"');
	});
});
