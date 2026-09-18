// @vitest-environment node
/**
 * dsh-rpc — the DshAuth cookie-mint lifecycle and the parser/builder arms
 * the route-level tests never reach.
 *
 * Pins: the 303+set-cookie mint (the one launch-token exchange), the
 * stale-token (non-303) and transport-failure refusals, the no-token
 * honest null, single-flight concurrent mints, invalidate→re-mint, plus
 * parseResponse/parseServerRequest/parseRespondReceipt rejection arms and
 * the DSH_ARGS.listDirectory / respondUrl / rpcUrl fallback arms.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	DSH_ARGS,
	DshAuth,
	DshRpcError,
	isSubagentRejection,
	mapRpcFailure,
	parseRespondReceipt,
	parseResponse,
	parseServerRequest,
	respondUrl,
	rpcUrl,
	statusFor
} from '$lib/server/dsh-rpc';

// Hermetic auth config: DSI_AUTH_TOKEN wins over the file, so the token
// tests only need an empty temp dir; the no-token test removes the env var.
const configDir = mkdtempSync(join(tmpdir(), 'dsi-rpc-config-'));
beforeAll(() => {
	process.env.DSI_CONFIG_PATH = configDir;
	process.env.DSI_AUTH_TOKEN = 'tok-1';
});
afterAll(() => {
	delete process.env.DSI_AUTH_TOKEN;
	delete process.env.DSI_CONFIG_PATH;
	rmSync(configDir, { recursive: true, force: true });
});
afterEach(() => {
	rmSync(join(configDir, 'settings.yaml'), { force: true });
});

function fetchResponder(fn: (url: string) => Promise<Response>): typeof fetch {
	return (async (input: RequestInfo | URL) => fn(String(input))) as unknown as typeof fetch;
}

describe('DshAuth — the one launch-token exchange (cookie carrier)', () => {
	it('mints the cookie from a 303 + set-cookie and reuses it (no second fetch)', async () => {
		let calls = 0;
		const auth = new DshAuth({
			baseUrl: 'http://127.0.0.1:9999',
			fetchFn: fetchResponder(async () => {
				calls += 1;
				return new Response(null, {
					status: 303,
					headers: { 'set-cookie': 'dsh_session=abc123; Path=/; HttpOnly' }
				});
			})
		});
		expect(auth.cookieHeader()).toBeUndefined();
		expect(await auth.ensureCookie()).toBe('dsh_session=abc123');
		expect(await auth.ensureCookie()).toBe('dsh_session=abc123');
		expect(calls).toBe(1);
		expect(auth.current()).toBe('dsh_session=abc123');
		expect(auth.cookieHeader()).toBe('dsh_session=abc123');
	});

	it('a non-303 exchange (stale token) leaves the cookie null — honest, no throw', async () => {
		const auth = new DshAuth({
			baseUrl: 'http://127.0.0.1:9999',
			fetchFn: fetchResponder(async () => new Response('nope', { status: 404 }))
		});
		expect(await auth.ensureCookie()).toBeNull();
		expect(auth.cookieHeader()).toBeUndefined();
	});

	it('a transport failure during the exchange resolves null (logged, never thrown)', async () => {
		const auth = new DshAuth({
			baseUrl: 'http://127.0.0.1:9999',
			fetchFn: fetchResponder(async () => {
				throw new Error('ECONNREFUSED');
			})
		});
		await expect(auth.ensureCookie()).resolves.toBeNull();
	});

	it('no token configured resolves null and never fetches (unfenced host)', async () => {
		const prev = process.env.DSI_AUTH_TOKEN;
		delete process.env.DSI_AUTH_TOKEN;
		try {
			let calls = 0;
			const auth = new DshAuth({
				baseUrl: 'http://127.0.0.1:9999',
				fetchFn: fetchResponder(async () => {
					calls += 1;
					return new Response(null, { status: 303 });
				})
			});
			await expect(auth.ensureCookie()).resolves.toBeNull();
			expect(calls).toBe(0);
		} finally {
			process.env.DSI_AUTH_TOKEN = prev;
		}
	});

	it('concurrent ensureCookie calls share ONE mint (single-flight)', async () => {
		let calls = 0;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const auth = new DshAuth({
			baseUrl: 'http://127.0.0.1:9999',
			fetchFn: fetchResponder(async () => {
				calls += 1;
				await gate;
				return new Response(null, {
					status: 303,
					headers: { 'set-cookie': 'dsh_session=shared; Path=/' }
				});
			})
		});
		const both = Promise.all([auth.ensureCookie(), auth.ensureCookie()]);
		await new Promise((resolve) => setTimeout(resolve, 5)); // both callers enter
		release();
		const [a, b] = await both;
		expect(calls).toBe(1);
		expect(a).toBe('dsh_session=shared');
		expect(b).toBe('dsh_session=shared');
	});

	it('invalidate forgets the cookie — the next ensureCookie re-mints (fresh host process)', async () => {
		let calls = 0;
		const auth = new DshAuth({
			baseUrl: 'http://127.0.0.1:9999',
			fetchFn: fetchResponder(async () => {
				calls += 1;
				return new Response(null, {
					status: 303,
					headers: { 'set-cookie': `dsh_session=mint-${calls}; Path=/` }
				});
			})
		});
		await auth.ensureCookie();
		auth.invalidate();
		expect(auth.current()).toBeNull();
		expect(await auth.ensureCookie()).toBe('dsh_session=mint-2');
		expect(calls).toBe(2);
	});
});

describe('dsh-rpc parser rejection arms', () => {
	it('parseServerRequest throws on non-JSON (malformed mux frame)', () => {
		expect(() => parseServerRequest('garbage{')).toThrow(/not JSON/);
	});

	it('parseResponse throws when the result slot is missing (not an RpcResult)', () => {
		const raw = JSON.stringify({ type: 'server-response', rpcId: 'r-1' });
		expect(() => parseResponse(raw, 'r-1')).toThrow(/not an RpcResult/);
	});

	it('a bare ok:false result without an error body throws a raw failure (never a fake DshRpcError)', () => {
		// Current wire behavior: the host always sends the error body on
		// ok:false; a malformed one surfaces the raw read failure.
		const raw = JSON.stringify({ type: 'server-response', rpcId: 'r-2', result: { ok: false } });
		let thrown: unknown;
		try {
			parseResponse(raw, 'r-2');
			expect.unreachable('should have thrown');
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect(thrown).not.toBeInstanceOf(DshRpcError);
	});

	it('parseRespondReceipt maps a non-string reason to "unknown"', () => {
		expect(parseRespondReceipt(JSON.stringify({ accepted: false, reason: 42 }))).toEqual({
			accepted: false,
			reason: 'unknown'
		});
	});
});

describe('dsh-rpc builder + mapping fallback arms', () => {
	it('DSH_ARGS.listDirectory omits the key for an absent path, carries it otherwise', () => {
		expect(DSH_ARGS.listDirectory(undefined)).toEqual({});
		expect(DSH_ARGS.listDirectory('/Users/x')).toEqual({ path: '/Users/x' });
	});

	it('mapRpcFailure maps a plain Error to host-unreachable with its message', () => {
		const body = mapRpcFailure(new Error('fetch failed: ECONNREFUSED'));
		expect(body.ok).toBe(false);
		expect(body.error).toEqual({ code: 'host-unreachable', message: 'fetch failed: ECONNREFUSED' });
	});

	it('mapRpcFailure stringifies a non-Error throw (never "undefined")', () => {
		const body = mapRpcFailure('boom');
		expect(body.error).toEqual({ code: 'host-unreachable', message: 'boom' });
	});

	it('respondUrl/rpcUrl fall back to dshBaseUrl when the base is omitted', () => {
		expect(respondUrl(undefined)).toBe('http://127.0.0.1:3080/api/respond');
		expect(rpcUrl(undefined, 'session/list')).toBe('http://127.0.0.1:3080/api/session/list');
	});

	it('statusFor + isSubagentRejection split the two error families', () => {
		expect(statusFor(new DshRpcError('session/agent-busy', 'busy'))).toBe(502);
		expect(statusFor(new Error('down'))).toBe(503);
		expect(isSubagentRejection(new DshRpcError('subagent/not-found', 'x'))).toBe(true);
		expect(isSubagentRejection(new DshRpcError('session/not-found', 'x'))).toBe(false);
		expect(isSubagentRejection(new Error('down'))).toBe(false);
	});
});
