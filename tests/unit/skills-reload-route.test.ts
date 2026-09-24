/**
 * skills reload route tests — POST /api/skills/reload (forced rebuild,
 * ADR D3) and POST /api/skills/reload/cancel (the bored-operator verb):
 *   - reload success returns {ok:true, snapshot, uninstallable};
 *   - an EngineCancelledError refresh resolves 200 {ok:false, cancelled:true}
 *     (the operator's own verb — no error note);
 *   - any other refresh failure surfaces 503 with the verbatim message;
 *   - cancel forwards cancelRefresh()'s boolean and, when a child was
 *     killed, best-effort rmSync's the progress sidecar (SHELF_PROGRESS_PATH
 *     override honored; rmSync throw swallowed).
 *
 * Handlers invoked directly; the engine module is mocked (the established
 * goal-route/workspace-tree-route pattern).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineCancelledError } from '$lib/server/skills/types';

const { refreshSpy, cancelRefreshSpy, rmSyncSpy } = vi.hoisted(() => ({
	refreshSpy: vi.fn(),
	cancelRefreshSpy: vi.fn(),
	rmSyncSpy: vi.fn()
}));
vi.mock('$lib/server/skills/engine', () => ({
	getEngine: () => ({ refresh: refreshSpy, cancelRefresh: cancelRefreshSpy }),
	cancelRefresh: cancelRefreshSpy
}));
vi.mock('node:fs', () => ({ rmSync: rmSyncSpy, default: { rmSync: rmSyncSpy } }));

import { POST as RELOAD_POST } from '../../src/routes/api/skills/reload/+server';
import { POST as CANCEL_POST } from '../../src/routes/api/skills/reload/cancel/+server';

const SNAPSHOT = { v: 1, generatedAt: 't', sources: [] };

beforeEach(() => {
	refreshSpy.mockReset();
	cancelRefreshSpy.mockReset();
	rmSyncSpy.mockReset();
	delete process.env.SHELF_PROGRESS_PATH;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/skills/reload', () => {
	it('returns ok:true with the snapshot and uninstallable ids on success', async () => {
		refreshSpy.mockResolvedValueOnce({ snapshot: SNAPSHOT });
		const res = await RELOAD_POST({} as never);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.snapshot).toEqual(SNAPSHOT);
		expect(body.uninstallable).toEqual([]); // no installedFrom-less skills
		expect(refreshSpy).toHaveBeenCalledExactlyOnceWith(true); // forced rebuild
	});

	it('returns 200 {ok:false, cancelled:true} when refresh throws EngineCancelledError', async () => {
		refreshSpy.mockRejectedValueOnce(new EngineCancelledError());
		const res = await RELOAD_POST({} as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: false, cancelled: true, error: 'reload cancelled' });
	});

	it('returns 503 with the verbatim message on any other refresh failure', async () => {
		refreshSpy.mockRejectedValueOnce(new Error('engine exploded'));
		const res = await RELOAD_POST({} as never);
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ ok: false, error: 'engine exploded' });
	});
});

describe('POST /api/skills/reload/cancel', () => {
	it('kills the in-flight child and rmSyncs the default progress sidecar', async () => {
		cancelRefreshSpy.mockReturnValueOnce(true);
		const res = await CANCEL_POST({} as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, cancelled: true });
		expect(rmSyncSpy).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining('skr-progress.json'),
			{ force: true }
		);
	});

	it('honors SHELF_PROGRESS_PATH when clearing the sidecar', async () => {
		process.env.SHELF_PROGRESS_PATH = '/tmp/custom-progress.json';
		cancelRefreshSpy.mockReturnValueOnce(true);
		const res = await CANCEL_POST({} as never);
		expect(await res.json()).toEqual({ ok: true, cancelled: true });
		expect(rmSyncSpy).toHaveBeenCalledWith('/tmp/custom-progress.json', { force: true });
	});

	it('swallows a sidecar rmSync failure and still reports cancelled', async () => {
		cancelRefreshSpy.mockReturnValueOnce(true);
		rmSyncSpy.mockImplementationOnce(() => {
			throw new Error('disk gone');
		});
		const res = await CANCEL_POST({} as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, cancelled: true });
	});

	it('reports cancelled:false and touches nothing when no refresh is in flight', async () => {
		cancelRefreshSpy.mockReturnValueOnce(false);
		const res = await CANCEL_POST({} as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, cancelled: false });
		expect(rmSyncSpy).not.toHaveBeenCalled();
	});
});