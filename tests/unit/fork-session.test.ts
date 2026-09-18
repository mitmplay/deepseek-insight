/**
 * fork-session unit tests — the shared fork spine (The Fork-Here Button
 * ADR, 2026-09-02): one POST with the optional anchor, the host's refusal
 * verbatim, the best-effort " (fork)" rename, after-source panel placement,
 * and the off-floor seed-navigation fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forkFromSession } from '$lib/services/conversation/fork-session';
import {
	registerAddPanel,
	resetPanelRegistryForTests
} from '$lib/services/panels/panel-registry';
import { setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';

const fetchMock = vi.fn();

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	resetPanelRegistryForTests();
	setWorkspaceState(null);
	vi.unstubAllGlobals();
	fetchMock.mockReset();
});

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const callsTo = (suffix: string): Array<[string, RequestInit | undefined]> =>
	fetchMock.mock.calls.filter((c) => String(c[0]).endsWith(suffix)) as Array<
		[string, RequestInit | undefined]
	>;

describe('forkFromSession — the shared fork spine', () => {
	it('atSeq omitted → POST body {}; the child lands AFTER the source, renamed " (fork)"', async () => {
		fetchMock.mockImplementation(async (url: string | URL | Request) =>
			String(url).endsWith('/rename')
				? jsonRes({ ok: true, title: 'Loader (fork)' })
				: jsonRes({ ok: true, sessionId: 'child-1' })
		);
		const add = vi.fn();
		registerAddPanel(add);

		const outcome = await forkFromSession({ sessionId: 'src-1', title: 'Loader', agentPreset: 'app-dev' });

		expect(outcome).toEqual({ ok: true, childId: 'child-1' });
		const [forkUrl, forkInit] = callsTo('/session/src-1/fork')[0];
		expect(String(forkUrl)).toBe('/api/dsh/session/src-1/fork');
		expect(JSON.parse(String(forkInit?.body))).toEqual({});
		expect(add).toHaveBeenCalledWith({
			sessionId: 'child-1',
			agentPreset: 'app-dev',
			focus: true,
			afterSessionId: 'src-1'
		});
		const [renameUrl, renameInit] = callsTo('/session/child-1/rename')[0];
		expect(String(renameUrl)).toBe('/api/dsh/session/child-1/rename');
		expect(JSON.parse(String(renameInit?.body))).toEqual({ title: 'Loader (fork)' });
	});

	it('a present atSeq rides the body; no title → no rename call', async () => {
		fetchMock.mockResolvedValue(jsonRes({ ok: true, sessionId: 'child-2' }));
		registerAddPanel(vi.fn());

		const outcome = await forkFromSession({ sessionId: 'src-1', atSeq: 41 });

		expect(outcome).toEqual({ ok: true, childId: 'child-2' });
		expect(JSON.parse(String(callsTo('/session/src-1/fork')[0][1]?.body))).toEqual({ atSeq: 41 });
		expect(callsTo('/rename')).toHaveLength(0);
	});

	it('the host refusal surfaces verbatim — nothing is placed', async () => {
		fetchMock.mockResolvedValue(
			jsonRes(
				{
					ok: false,
					error: {
						code: 'session/fork-unavailable',
						message: 'session "src-1" has not completed the turn containing event 41'
					}
				},
				502
			)
		);
		const add = vi.fn();
		registerAddPanel(add);

		const outcome = await forkFromSession({ sessionId: 'src-1', atSeq: 41 });

		expect(outcome).toEqual({
			ok: false,
			message: 'session "src-1" has not completed the turn containing event 41'
		});
		expect(add).not.toHaveBeenCalled();
	});

	it('a non-JSON failure carries the HTTP status', async () => {
		fetchMock.mockResolvedValue(new Response('gateway down', { status: 503 }));

		const outcome = await forkFromSession({ sessionId: 'src-1' });

		expect(outcome).toEqual({ ok: false, message: 'fork failed (HTTP 503)' });
	});

	it('a transport failure carries the error message verbatim', async () => {
		fetchMock.mockRejectedValue(new Error('host unreachable'));

		const outcome = await forkFromSession({ sessionId: 'src-1' });

		expect(outcome).toEqual({ ok: false, message: 'host unreachable' });
	});

	it('off-floor: the seed-navigation fallback takes the child URL (rename skipped, no title)', async () => {
		fetchMock.mockResolvedValue(jsonRes({ ok: true, sessionId: 'child-9' }));
		const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});

		try {
			const outcome = await forkFromSession({ sessionId: 'src-1', title: null });
			expect(outcome).toEqual({ ok: true, childId: 'child-9' });
			expect(assign).toHaveBeenCalledTimes(1);
			expect(String(assign.mock.calls[0]?.[0])).toContain('child-9');
			expect(fetchMock).toHaveBeenCalledTimes(1); // the fork POST only — no rename
		} finally {
			assign.mockRestore();
		}
	});
});
