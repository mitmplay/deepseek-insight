/**
 * api-workspace — GET /api/workspace/git-events?sessionId=…&root=…&repo=…(&repo=…)
 *
 * The Index Pulse's SSE stream (ADR 2026-09-13, D3/D5): one server-sent
 * events channel per explorer panel. The gate is resolved at connect —
 * closed means the plain git-status JSON contract ({ ok:true,
 * enabled:false }), NOT a stream. Open, the stream speaks two events:
 * `generation` (a per-workspace monotonic integer, one per debounced ring)
 * and `enabled:false` (the gate died mid-stream; the panel degrades to
 * today's manual-Refresh world). TRUTH NEVER RIDES THIS STREAM — the panel
 * refetches rows through the unchanged gated git-status route. Watchers
 * are refcounted per workspace; the last client's disconnect closes them.
 */
import { json } from '@sveltejs/kit';

import { gitGateEnabled, isInsideRoot } from '$lib/server/git-probe';
import { acquireWatch, getGeneration, onGeneration } from '$lib/server/git-watch';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, request }) => {
	const sessionId = url.searchParams.get('sessionId');
	const root = url.searchParams.get('root');
	const repos = url.searchParams.getAll('repo').filter((r) => r.trim().length > 0);
	if (
		sessionId === null || sessionId.trim().length === 0 ||
		root === null || root.trim().length === 0 ||
		repos.length === 0
	) {
		return json(
			{ ok: false, error: { code: 'bad-params', message: 'sessionId, root and at least one repo are required' } },
			{ status: 400 }
		);
	}

	let enabled: boolean;
	try {
		enabled = await gitGateEnabled(sessionId);
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
	if (!enabled) return json({ ok: true, enabled: false });

	for (const repo of repos) {
		if (!(await isInsideRoot(root, repo))) {
			return json(
				{ ok: false, error: { code: 'outside-workspace', message: 'the repo path is not inside the workspace root' } },
				{ status: 403 }
			);
		}
	}

	const encoder = new TextEncoder();
	const workspaceKey = root;
	let cleanup: () => void = () => undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			const send = (event: string, data: string): void => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode('event: ' + event + '\ndata: ' + data + '\n\n'));
				} catch {
					closed = true;
				}
			};

			// First event: the generation as of connect — the panel compares
			// its fetched-at value against this before its first refetch.
			send('generation', String(getGeneration(workspaceKey)));

			const leases = repos.map((repo) =>
				acquireWatch({
					workspaceKey,
					repo,
					gateCheck: () => gitGateEnabled(sessionId),
					onGateClosed: () => {
						send('enabled', 'false');
						finish();
					}
				})
			);
			const unsubscribe = onGeneration(workspaceKey, (generation) => {
				send('generation', String(generation));
			});

			// Proxy-proofing: a comment ping keeps intermediaries from timing
			// the stream out; a buffered proxy degrades to manual Refresh.
			const ping = setInterval(() => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					closed = true;
				}
			}, 25_000);

			function finish(): void {
				if (closed) return;
				closed = true;
				clearInterval(ping);
				unsubscribe();
				for (const lease of leases) void lease.release();
				try {
					controller.close();
				} catch {
					// already closed by the platform
				}
			}
			cleanup = finish;

			request.signal.addEventListener('abort', finish);
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
