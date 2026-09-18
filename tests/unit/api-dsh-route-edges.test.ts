// @vitest-environment node
/**
 * api-dsh route edges the main suite's happy paths miss.
 *
 * Pins: the events route's full=1 resync against an EMPTY tail page (no
 * projections → the projection-derived keys are honestly omitted, lastSeq
 * falls back to −1) and its DshRpcError→502 mapping; the sessions POST cwd
 * validation + the empty-string agentPreset→inherit normalization; the
 * command route's empty-line refusal and the receipt arms whose text is
 * absent (error fallback message; success body without a text key).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DshRpcError as TDshRpcError } from '$lib/server/dsh-rpc';

/** The connection members these routes touch. */
interface FakeApi {
	ensureDownlinks: () => void;
	subscribe: (id: string) => void;
	eventsSince: (id: string, n: number) => unknown;
	liveAssistantStream: (id: string) => unknown;
	projectionValue: (id: string, key: string) => unknown;
	pendingFor: (id: string) => unknown[];
	settlementsFor: (id: string) => unknown[];
	pruneSettlements: (id: string, rpcIds: string[]) => void;
	history: (id: string) => Promise<unknown>;
	isRunning: (id: string) => boolean;
	listSessions: () => Promise<unknown>;
	createSession: (cwd?: string, agentPreset?: string) => Promise<unknown>;
	executeCommand: (id: string, line: string) => Promise<unknown>;
}

let fake: FakeApi;
let DshRpcError: typeof TDshRpcError;

function mkEvent(e: Record<string, unknown>): never {
	return { setHeaders: () => {}, ...e } as never;
}

async function importRoutesFresh() {
	vi.resetModules();
	const conn = await import('$lib/server/dsh-connection');
	vi.spyOn(conn, 'getDshConnection').mockImplementation(() => fake as never);
	DshRpcError = (await import('$lib/server/dsh-rpc')).DshRpcError;
	const sessions = await import('../../src/routes/api/dsh/sessions/+server');
	const events = await import('../../src/routes/api/dsh/session/[sessionId]/events/+server');
	const command = await import('../../src/routes/api/dsh/session/[sessionId]/command/+server');
	return { sessions, events, command };
}

beforeEach(() => {
	fake = {
		ensureDownlinks: () => {},
		subscribe: () => {},
		eventsSince: () => ({ events: [], lastSeq: -1, running: false, gap: false }),
		liveAssistantStream: () => null,
		projectionValue: () => undefined,
		pendingFor: () => [],
		settlementsFor: () => [],
		pruneSettlements: () => {},
		history: async () => ({ events: [], hasMore: false }),
		isRunning: () => false,
		listSessions: async () => ({ items: [] }),
		createSession: async () => ({ sessionId: 'new-1' }),
		executeCommand: async () => null
	};
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET …/events?full=1 — empty-tail resync edges', () => {
	it('an empty ledger page with no projections serves lastSeq −1 and omits every projection key', async () => {
		const { events } = await importRoutesFresh();
		const res = await events.GET(
			mkEvent({ params: { sessionId: 's-blank' }, url: new URL('http://dsi/events?since=-1&full=1') })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
		expect(body.entries).toEqual([]);
		expect(body.lastSeq).toBe(-1); // no ledger events → the −1 fallback
		expect(body.running).toBe(false);
		expect(body.pendingAnswers).toEqual([]);
		expect(body.settledAnswers).toEqual([]);
		expect(body.knobEvents).toEqual([]);
		// No projections block → every derived value is honestly empty/null.
		expect(body.permission).toBeNull();
		expect(body.imageLimits).toBeNull();
		expect(body.plan).toBeNull();
		expect('todos' in body).toBe(false); // undefined drops out of the JSON body
	});

	it('a delta poll carries the live projection values when the control store holds them', async () => {
		fake.eventsSince = () => ({
			events: [{ type: 'user/message', seq: 2, time: 2, data: {} }],
			lastSeq: 2,
			running: true,
			gap: false
		});
		fake.projectionValue = (_id: string, key: string) => {
			if (key === 'permissions') {
				return { currentValue: 'read-only', options: [{ value: 'read-only', name: 'read-only' }] };
			}
			if (key === 'imageLimits') {
				return {
					maxImageBytes: 1_000_000,
					maxImagesPerMessage: 4,
					maxMessageImageBytes: 4_000_000,
					maxImagePixels: 8_000_000,
					maxImageDimension: 4096,
					mediaTypes: ['image/png', 'image/jpeg']
				};
			}
			if (key === 'todos') return [{ content: 'ship the tests', status: 'pending' }];
			if (key === 'plan') return { active: true, pending: false };
			return undefined;
		};
		const { events } = await importRoutesFresh();
		const res = await events.GET(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/events?since=0') })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.entries).toHaveLength(1);
		expect(body.permission).toMatchObject({ current: 'read-only' });
		expect(body.imageLimits).toMatchObject({ maxImagesPerMessage: 4 });
		expect(body.todos).toEqual([{ content: 'ship the tests', status: 'pending' }]);
		expect(body.plan).toEqual({ active: true, pending: false });
	});

	it('a host refusal on the resync maps to 502 with the host code', async () => {
		fake.history = async () => {
			throw new DshRpcError('session/not-found', 'nope');
		};
		const { events } = await importRoutesFresh();
		const res = await events.GET(
			mkEvent({ params: { sessionId: 'ghost' }, url: new URL('http://dsi/events?full=1') })
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('session/not-found');
	});

	it('a transport failure on the resync maps to 503 host-unreachable', async () => {
		fake.history = async () => {
			throw new Error('ECONNREFUSED');
		};
		const { events } = await importRoutesFresh();
		const res = await events.GET(
			mkEvent({ params: { sessionId: 's1' }, url: new URL('http://dsi/events?full=1') })
		);
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('host-unreachable');
	});
});

describe('POST /api/dsh/sessions — cwd + preset body edges', () => {
	it('rejects a non-string cwd with 400 bad-cwd', async () => {
		const { sessions } = await importRoutesFresh();
		const res = await sessions.POST(
			mkEvent({ request: new Request('http://dsi/sessions', { method: 'POST', body: JSON.stringify({ cwd: 42 }) }) })
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-cwd');
	});

	it('rejects an EMPTY cwd string with 400 bad-cwd', async () => {
		const { sessions } = await importRoutesFresh();
		const res = await sessions.POST(
			mkEvent({ request: new Request('http://dsi/sessions', { method: 'POST', body: JSON.stringify({ cwd: '' }) }) })
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('bad-cwd');
	});

	it('an empty-string agentPreset means INHERIT — the create gets no preset', async () => {
		let seen: { cwd?: string; preset?: string } | undefined;
		fake.createSession = async (cwd, preset) => {
			seen = { cwd, preset };
			return { sessionId: 'new-inherit' };
		};
		const { sessions } = await importRoutesFresh();
		const res = await sessions.POST(
			mkEvent({
				request: new Request('http://dsi/sessions', {
					method: 'POST',
					body: JSON.stringify({ cwd: '/w/proj', agentPreset: '' })
				})
			})
		);
		expect(res.status).toBe(200);
		expect(seen).toEqual({ cwd: '/w/proj', preset: undefined });
		const body = (await res.json()) as { agentPreset: string | null };
		expect(body.agentPreset).toBeNull();
	});
});

describe('POST …/command — refusal + receipt arms', () => {
	it('a body without a line field is 400 empty-line (validation, not transport)', async () => {
		const { command } = await importRoutesFresh();
		const res = await command.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/command', { method: 'POST', body: JSON.stringify({}) })
			})
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('empty-line');
	});

	it('a whitespace-only line is 400 empty-line', async () => {
		const { command } = await importRoutesFresh();
		const res = await command.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/command', { method: 'POST', body: JSON.stringify({ line: '   ' }) })
			})
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('empty-line');
	});

	it('an error receipt without text falls back to the generic message', async () => {
		fake.executeCommand = async () => ({ commandId: 'cmd-4', result: { kind: 'error' } });
		const { command } = await importRoutesFresh();
		const res = await command.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/command', { method: 'POST', body: JSON.stringify({ line: '/plan off' }) })
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('command-error');
		expect(body.error.message).toBe('the command reported an error');
	});

	it('a success receipt without text omits the text key (no invented output)', async () => {
		fake.executeCommand = async () => ({ commandId: 'cmd-5', result: { kind: 'success' } });
		const { command } = await importRoutesFresh();
		const res = await command.POST(
			mkEvent({
				params: { sessionId: 's1' },
				request: new Request('http://dsi/command', { method: 'POST', body: JSON.stringify({ line: '/compact' }) })
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({ ok: true, executed: true, commandId: 'cmd-5' });
		expect('text' in body).toBe(false);
	});
});
