// @vitest-environment node
/**
 * GET /api/config — the operator-config endpoint: one shape, always ok,
 * every browser-tunable section present (the read* helpers own the
 * defaults; insight-config.test.ts pins them — this pins the route).
 */
import { describe, expect, it } from 'vitest';
import { GET } from '../../src/routes/api/config/+server';

describe('GET /api/config', () => {
	it('answers ok with every browser-tunable section', async () => {
		const res = await GET(new Request('http://dsi/api/config') as unknown as Parameters<typeof GET>[0]);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
		for (const section of ['chat', 'conversation', 'home', 'a2a', 'panel', 'sidebar']) {
			expect(body[section]).toBeDefined();
		}
		// The server-only section is intentionally absent — dsh-connection
		// reads it directly server-side.
		expect(body.server).toBeUndefined();
	});
});
