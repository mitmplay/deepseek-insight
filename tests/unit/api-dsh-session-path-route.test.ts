/**
 * /api/dsh/session/[sessionId]/path route tests (Task 1.3-T, spec
 * "2026-09-14 - The Session Full Path") — the joined server seam:
 * 200 {ok, path} on a found directory; 404 on a miss, on a missing
 * root, and when the yaml root has no directory; env override honored.
 *
 * Handlers invoked directly with node-env request objects (the
 * goal-route.test.ts pattern); the disk is a temp root via the
 * DSI_SESSIONS_ROOT env seam; the yaml root rides DSI_CONFIG_PATH.
 *
 * Node env (environmentMatchGlobs) — server-only route.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../../src/routes/api/dsh/session/[sessionId]/path/+server';

let root: string;
let configDir: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dsi-path-route-root-'));
	configDir = mkdtempSync(join(tmpdir(), 'dsi-path-route-cfg-'));
	process.env.DSI_SESSIONS_ROOT = root;
	process.env.DSI_CONFIG_PATH = join(configDir, 'settings.yaml');
});

afterEach(() => {
	delete process.env.DSI_SESSIONS_ROOT;
	delete process.env.DSI_CONFIG_PATH;
});

function get(sessionId: string): Promise<Response> {
	return GET({
		params: { sessionId },
		setHeaders: () => {}
	} as never) as Promise<Response>;
}

describe('GET /api/dsh/session/[sessionId]/path', () => {
	it('answers 200 with the absolute directory path on a found session', async () => {
		// Real layout: <root>/<projectDir>/session-<id> (RCA 2026-09-14).
		const expected = join(root, '--Users-op-proj--', 'session-abc-123');
		mkdirSync(expected, { recursive: true });
		const res = await get('abc-123');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, path: expected });
	});

	it('answers 404 on a miss — never a guessed path', async () => {
		const res = await get('missing-id');
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('session-path-not-found');
	});

	it('answers 404 when the root does not exist', async () => {
		process.env.DSI_SESSIONS_ROOT = join(root, 'no-such-root');
		const res = await get('abc-123');
		expect(res.status).toBe(404);
	});

	it('honors the yaml root when no env override is set', async () => {
		delete process.env.DSI_SESSIONS_ROOT;
		writeFileSync(
			join(configDir, 'settings.yaml'),
			`dsh:\n  sessionsRoot: ${JSON.stringify(root)}\n`,
			'utf-8'
		);
		const expected = join(root, '--Users-op-proj--', 'session-yaml-id');
		mkdirSync(expected, { recursive: true });
		const res = await get('yaml-id');
		expect(res.status).toBe(200);
		expect(((await res.json()) as { path: string }).path).toBe(expected);
	});

	it('marks the answer no-store — the disk is the authority per render', async () => {
		// Direct-handler invocation: setHeaders is a spy — assert the header
		// the SvelteKit runtime would apply (the goal-route pattern).
		const setHeaders = vi.fn();
		await GET({ params: { sessionId: 'anything' }, setHeaders } as never);
		expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
	});
});
