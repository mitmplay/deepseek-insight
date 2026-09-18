/**
 * write-gate route tests (Always Tabs follow-up 2026-09-16): the file
 * panel's WRITE gate rides the SAME fresh gitGateEnabled resolution the
 * watcher stream and the write route use — bad params reject 400, the
 * gate verdict passes through untouched, and a gate-resolution failure
 * keeps the shared error face. This route is the anti-confusion pin:
 * git-map's \`enabled\` no longer means "may write", this one does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gateSpy } = vi.hoisted(() => ({
	gateSpy: vi.fn()
}));

vi.mock('$lib/server/git-probe', () => ({
	gitGateEnabled: gateSpy
}));

import { GET } from '../../src/routes/api/workspace/write-gate/+server';

function get(query: string): Promise<Response> {
	return GET({ url: new URL('http://localhost/api/workspace/write-gate' + query) } as never) as Promise<Response>;
}

beforeEach(() => {
	gateSpy.mockReset();
});

describe('GET /api/workspace/write-gate', () => {
	it('rejects a missing sessionId with 400 before anything runs', async () => {
		expect((await get('')).status).toBe(400);
		expect((await get('?sessionId=')).status).toBe(400);
		expect(gateSpy).not.toHaveBeenCalled();
	});

	it('passes the fresh gate verdict through untouched (open AND closed)', async () => {
		gateSpy.mockResolvedValueOnce(true);
		const open = await get('?sessionId=s1');
		expect(await open.json()).toEqual({ ok: true, enabled: true });
		expect(gateSpy).toHaveBeenCalledWith('s1');
		gateSpy.mockResolvedValueOnce(false);
		const closed = await get('?sessionId=s1');
		expect(await closed.json()).toEqual({ ok: true, enabled: false });
	});

	it('a gate-resolution failure keeps the shared error face', async () => {
		gateSpy.mockRejectedValueOnce(new Error('host unreachable'));
		const res = await get('?sessionId=s1');
		expect(res.status).toBe(503);
	});
});
