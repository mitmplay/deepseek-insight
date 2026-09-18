/**
 * api-workspace — GET /api/workspace/git-map?sessionId=…&dir=…
 *
 * Per-level repo flags for the workspace explorer (Git Eye ADR 2026-09-12,
 * D1/D3): which immediate child directories host a .git entry, and whether
 * the level itself does. Detection lives in $lib/server/git-probe and is
 * DESK-INDEPENDENT (The Always Tabs ADR 2026-09-16, D2 — superseding the
 * Git Eye's gate here): a point-in-time READ answers on every access mode,
 * the same read class as the workspace-tree listing. The watcher stream
 * (git-events) and the write route keep their gates. Errors keep the
 * explorer's honest failure face: a vanished directory is 404 not-found, a
 * forbidden one 403, anything else the shared status mapping.
 */
import { json } from '@sveltejs/kit';

import { detectRepos } from '$lib/server/git-probe';
import { statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

function errnoStatus(err: unknown): number {
	const code = (err as NodeJS.ErrnoException | null)?.code;
	if (code === 'ENOENT') return 404;
	if (code === 'EACCES' || code === 'EPERM') return 403;
	return statusFor(err);
}

export const GET: RequestHandler = async ({ url }) => {
	const sessionId = url.searchParams.get('sessionId');
	const dir = url.searchParams.get('dir');
	if (sessionId === null || sessionId.trim().length === 0 || dir === null || dir.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-params', message: 'sessionId and dir are required' } },
			{ status: 400 }
		);
	}

	void sessionId; // the gate is gone (Always Tabs D2) — the param stays part of the contract
	try {
		const map = await detectRepos(dir);
		return json({ ok: true, enabled: true, ...map });
	} catch (err) {
		return json(
			{ ok: false, error: { code: 'probe-failed', message: err instanceof Error ? err.message : 'probe failed' } },
			{ status: errnoStatus(err) }
		);
	}
};
