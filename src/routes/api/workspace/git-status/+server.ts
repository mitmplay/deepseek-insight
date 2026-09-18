/**
 * api-workspace — GET /api/workspace/git-status?sessionId=…&root=…&repo=…
 *
 * Working-tree changes for ONE repo root, grouped view source (Git Eye ADR
 * 2026-09-12, D5): the DSI server runs a READ-ONLY git status, DESK-
 * INDEPENDENT (The Always Tabs ADR 2026-09-16, D2 — superseding the Git
 * Eye's gate for point-in-time reads). The repo must BE the explorer's
 * workspace root or live inside it — realpath containment, refused 403
 * outside-workspace. A missing git binary is a VISIBLE failure
 * ({ ok:false, code: 'git-unavailable' }), never a blank pane.
 */
import { json } from '@sveltejs/kit';

import { GitUnavailableError, gitStatus, isInsideRoot } from '$lib/server/git-probe';
import { statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const sessionId = url.searchParams.get('sessionId');
	const root = url.searchParams.get('root');
	const repo = url.searchParams.get('repo');
	if (
		sessionId === null || sessionId.trim().length === 0 ||
		root === null || root.trim().length === 0 ||
		repo === null || repo.trim().length === 0
	) {
		return json(
			{ ok: false, error: { code: 'bad-params', message: 'sessionId, root and repo are required' } },
			{ status: 400 }
		);
	}

	void sessionId; // the gate is gone (Always Tabs D2) — the param stays part of the contract
	if (!(await isInsideRoot(root, repo))) {
		return json(
			{ ok: false, error: { code: 'outside-workspace', message: 'the repo path is not inside the workspace root' } },
			{ status: 403 }
		);
	}

	try {
		const status = await gitStatus(repo);
		return json({ ok: true, enabled: true, ...status });
	} catch (err) {
		if (err instanceof GitUnavailableError) {
			return json({ ok: false, code: 'git-unavailable', message: err.message });
		}
		return json(
			{ ok: false, error: { code: 'status-failed', message: err instanceof Error ? err.message : 'status failed' } },
			{ status: statusFor(err) }
		);
	}
};
