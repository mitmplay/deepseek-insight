/**
 * goal-route tests (Task 1.1-T, spec "2026-09-09 - DSI Goal Editor") — the
 * route-level edit contract (ADR "The Goal Editor" D1/D3/D5):
 *   - verb 'edit' with a valid payload forwards {agentId, ref, request} to
 *     the connection's goalVerb and resolves a success as {ok:true, value}
 *     (the rpc-unwrapped value IS success — the 2026-09-09 seam);
 *   - an empty/invalid edit payload is rejected 400 bad-edit BEFORE any rpc;
 *   - pause/resume/clear forwarding is unchanged (no request argument);
 *   - a stale-ref refusal retries once with the host-named revision; a
 *     second refusal surfaces 409 with the host's verbatim message.
 *
 * Handlers invoked directly with node-env Request objects; the connection
 * is mocked (the established a2a-routes.test.ts pattern).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DshRpcError } from '$lib/server/dsh-rpc';

const goalVerbSpy = vi.fn();
// Projection source for the stale-ref fallback: the route consults the
// connection's freshest goal projection when the refusal message form
// changes. Mutable per test via __dsiGoalProjection.
vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({
		goalVerb: goalVerbSpy,
		projectionValue: () => (globalThis as any).__dsiGoalProjection ?? null
	})
}));

import { POST } from '../../src/routes/api/dsh/session/[sessionId]/goal/+server';

const REF = { id: 'goal-1', revision: 3 };

function post(body: unknown): Promise<Response> {
	return POST({
		params: { sessionId: 'session-1' },
		request: new Request('http://localhost/api/dsh/session/session-1/goal', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as never) as Promise<Response>;
}

function editBody(edit: unknown): unknown {
	return { verb: 'edit', ref: REF, edit };
}

beforeEach(() => {
	goalVerbSpy.mockReset();
	(globalThis as any).__dsiGoalProjection = undefined;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/dsh/session/[sessionId]/goal — verb edit (Task 1.1-T)', () => {
	it('forwards {agentId, ref, request} and resolves the unwrapped value as ok:true', async () => {
		const view = { id: 'goal-1', revision: 4, objective: 'new objective', phase: 'paused' };
		goalVerbSpy.mockResolvedValueOnce(view);
		const res = await post(editBody({ objective: '  new objective  ' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, value: view });
		expect(goalVerbSpy).toHaveBeenCalledExactlyOnceWith('edit', 'session-1', REF, { objective: '  new objective  ' });
	});

	it('forwards a rounds-only edit payload', async () => {
		goalVerbSpy.mockResolvedValueOnce({ id: 'goal-1', revision: 4 });
		const res = await post(editBody({ maxGoalRounds: 12 }));
		expect(res.status).toBe(200);
		expect(goalVerbSpy).toHaveBeenCalledExactlyOnceWith('edit', 'session-1', REF, { maxGoalRounds: 12 });
	});

	it.each([
		['missing payload', undefined],
		['null payload', null],
		['empty object', {}],
		['array payload', ['x']],
		['whitespace objective', { objective: '   ' }],
		['zero rounds', { maxGoalRounds: 0 }],
		['negative rounds', { maxGoalRounds: -1 }],
		['fractional rounds', { maxGoalRounds: 1.5 }]
	])('rejects %s with 400 bad-edit before any rpc', async (_name, edit) => {
		const res = await post(editBody(edit));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe('bad-edit');
		expect(goalVerbSpy).not.toHaveBeenCalled();
	});

	it('retries a stale-ref refusal with the host-named revision and succeeds', async () => {
		goalVerbSpy
			.mockRejectedValueOnce(new DshRpcError('GOAL_STALE_REVISION', 'stale goal ref "goal-1" revision 3; current is "goal-1" revision 5'))
			.mockResolvedValueOnce({ id: 'goal-1', revision: 6, objective: 'edited' });
		const res = await post(editBody({ objective: 'edited' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, value: { id: 'goal-1', revision: 6, objective: 'edited' } });
		expect(goalVerbSpy).toHaveBeenCalledTimes(2);
		expect(goalVerbSpy.mock.calls[1]).toEqual(['edit', 'session-1', { id: 'goal-1', revision: 5 }, { objective: 'edited' }]);
	});

	it('surfaces the second refusal as 409 with the host message verbatim', async () => {
		goalVerbSpy
			.mockRejectedValueOnce(new DshRpcError('GOAL_STALE_REVISION', 'stale goal ref "goal-1" revision 3; current is "goal-1" revision 5'))
			.mockRejectedValueOnce(new DshRpcError('GOAL_INVALID_TRANSITION', 'goal "goal-1" is already active and armed'));
		// The route's fall-through reports the ORIGINAL stale-ref error — the
		// operator truth ("current is revision 5") — swallowing the retry's
		// secondary error (the established seam semantics).
		const res = await post(editBody({ objective: 'edited' }));
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error.code).toBe('GOAL_STALE_REVISION');
		expect(body.error.message).toContain('stale goal ref "goal-1" revision 3; current is "goal-1" revision 5');
	});
});

describe('POST /api/dsh/session/[sessionId]/goal — pause/resume/clear regression pin', () => {
	it.each(['pause', 'resume', 'clear'] as const)('forwards %s with no request argument', async (verb) => {
		goalVerbSpy.mockResolvedValueOnce({ id: 'goal-1', revision: 4 });
		const res = await post({ verb, ref: REF });
		expect(res.status).toBe(200);
		expect(goalVerbSpy).toHaveBeenCalledExactlyOnceWith(verb, 'session-1', REF, undefined);
	});

	it('still rejects an unknown verb with 400 bad-verb', async () => {
		const res = await post({ verb: 'rebalance', ref: REF });
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('bad-verb');
	});
});

// --- Coverage round: the untaken seams (invalid JSON, non-DshRpcError
// transport failure, projection-fallback retry when the refusal message form
// changes, a no-op retry that falls through to the honest refusal). ---

async function postRaw(raw: string): Promise<Response> {
	return POST({
		params: { sessionId: 'session-1' },
		request: new Request('http://localhost/api/dsh/session/session-1/goal', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: raw
		})
	} as never) as Promise<Response>;
}

describe('POST goal — error and fallback seams', () => {
	it('a non-JSON body answers 400 bad-json', async () => {
		const res = await postRaw('{not json');
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe('bad-json');
		expect(goalVerbSpy).not.toHaveBeenCalled();
	});

	it('a non-DshRpcError rejection maps to 503 host-unreachable', async () => {
		goalVerbSpy.mockRejectedValueOnce(new TypeError('fetch failed'));
		const res = await post({ verb: 'pause', ref: REF });
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('host-unreachable');
	});

	it('a stale refusal whose message names no revision falls back to the projection revision', async () => {
		(globalThis as any).__dsiGoalProjection = { goal: { id: 'goal-1', revision: 7, objective: 'obj', phase: 'active' } };
		goalVerbSpy
			.mockRejectedValueOnce(new DshRpcError('GOAL_STALE_REVISION', 'stale goal ref "goal-1" — the form changed'))
			.mockResolvedValueOnce({ id: 'goal-1', revision: 7 });
		const res = await post({ verb: 'resume', ref: REF });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, value: { id: 'goal-1', revision: 7 } });
		expect(goalVerbSpy.mock.calls[1]).toEqual(['resume', 'session-1', { id: 'goal-1', revision: 7 }, undefined]);
	});

	it('a projection fallback matching the sent revision skips the retry and refuses 409', async () => {
		(globalThis as any).__dsiGoalProjection = { goal: { id: 'goal-1', revision: 3, objective: 'obj', phase: 'active' } };
		goalVerbSpy.mockRejectedValueOnce(
			new DshRpcError('GOAL_STALE_REVISION', 'stale goal ref "goal-1" — no named revision')
		);
		const res = await post({ verb: 'clear', ref: REF });
		expect(res.status).toBe(409);
		expect(goalVerbSpy).toHaveBeenCalledTimes(1);
	});

	it('a projection for a different goal id yields no retry revision (409)', async () => {
		(globalThis as any).__dsiGoalProjection = { goal: { id: 'goal-other', revision: 9, objective: 'obj', phase: 'active' } };
		goalVerbSpy.mockRejectedValueOnce(
			new DshRpcError('GOAL_STALE_REVISION', 'stale goal ref "goal-1" — no named revision')
		);
		const res = await post({ verb: 'pause', ref: REF });
		expect(res.status).toBe(409);
		expect(goalVerbSpy).toHaveBeenCalledTimes(1);
	});

	it('a ref with a non-integer revision answers 400 bad-ref', async () => {
		const res = await post({ verb: 'pause', ref: { id: 'goal-1', revision: 1.5 } });
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('bad-ref');
	});
});
