// @vitest-environment node
/**
 * +page.server load — the failure arms the page-suite happy paths miss.
 *
 * Pins: a rejecting waitForProjections degrades to the tail-page baseline
 * (the bounded wait's catch → null, never a failed cold load), and a
 * non-Error transport throw still surfaces the distinct 503 page state
 * (message without an err.message interpolation).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type LoadFn = (event: { url: URL }) => Promise<Record<string, unknown>>;

function seedUrl(sid: string): URL {
	return new URL(`http://dsi/?sessionKey=${sid}`);
}

async function importLoadFresh(fake: Record<string, unknown>): Promise<LoadFn> {
	vi.resetModules();
	const conn = await import('$lib/server/dsh-connection');
	vi.spyOn(conn, 'getDshConnection').mockImplementation(() => fake as never);
	const mod = await import('../../src/routes/+page.server');
	return mod.load as LoadFn;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('+page.server load — degraded-baseline arms', () => {
	it('a rejecting waitForProjections falls back to the tail page (catch → null)', async () => {
		const load = await importLoadFresh({
			history: async () => ({
				events: [{ event: { type: 'user/message', seq: 1, time: 1001, data: { text: 'hi' } } }],
				hasMore: false
			}),
			ensureDownlinks: () => {},
			subscribe: () => {},
			waitForProjections: async () => {
				throw new Error('projection wait exploded');
			},
			isRunning: () => false,
			listSessions: async () => ({
				items: [{ sessionId: 's1', workspace: '/w/proj', agentPreset: 'main' }]
			})
		});
		const data = await load({ url: seedUrl('s1') });
		expect(data.sessionId).toBe('s1');
		expect(data.workspace).toBe('/w/proj');
		expect(data.agentPreset).toBe('main');
		expect(data.entries).toHaveLength(1);
	});

	it('a NON-Error transport throw still maps to the distinct 503 page state', async () => {
		const load = await importLoadFresh({
			history: async () => {
				throw 'host socket vanished'; // non-Error rejection
			}
		});
		await expect(load({ url: seedUrl('s1') })).rejects.toMatchObject({
			status: 503,
			body: { message: 'Cannot reach the DSH host for session history.' }
		});
	});

	it('a failed session.list hides the header chips but never fails the cold load', async () => {
		const load = await importLoadFresh({
			history: async () => ({ events: [], hasMore: false }),
			ensureDownlinks: () => {},
			subscribe: () => {},
			waitForProjections: async () => null,
			isRunning: () => false,
			listSessions: async () => {
				throw new Error('list down');
			}
		});
		const data = await load({ url: seedUrl('s1') });
		expect(data.workspace).toBeNull();
		expect(data.agentPreset).toBeNull();
		expect(data.entries).toEqual([]);
	});
});
