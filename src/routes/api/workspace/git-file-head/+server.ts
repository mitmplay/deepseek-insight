/**
 * api-workspace — GET /api/workspace/git-file-head?sessionId=…&root=…&path=…
 *
 * The File Eye's "before" side (ADR The File Eye 2026-09-12, D2): the
 * DSI server resolves the file's enclosing repo and runs a READ-ONLY
 * git show HEAD:<rel>, DESK-INDEPENDENT (The Always Tabs ADR 2026-09-16,
 * D2 — a point-in-time read answers on every access mode). head is null
 * when git has no version of the path (untracked / newly added) — the
 * honest no-before-version, never an error. Containment over realpaths.
 */
import { json } from '@sveltejs/kit';

import {
	GitUnavailableError,
	gitFileHead,
	isInsideRoot,
	resolveEnclosingRepo
} from '$lib/server/git-probe';
import { statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const sessionId = url.searchParams.get('sessionId');
	const root = url.searchParams.get('root');
	const path = url.searchParams.get('path');
	if (
		sessionId === null || sessionId.trim().length === 0 ||
		root === null || root.trim().length === 0 ||
		path === null || path.trim().length === 0
	) {
		return json(
			{ ok: false, error: { code: 'bad-params', message: 'sessionId, root and path are required' } },
			{ status: 400 }
		);
	}

	void sessionId; // the gate is gone (Always Tabs D2) — the param stays part of the contract
	const enclosing = await resolveEnclosingRepo(root, path);
	if (enclosing === null) {
		return json(
			{ ok: false, error: { code: 'no-repo', message: 'no git repo encloses this path' } },
			{ status: 404 }
		);
	}
	if (!(await isInsideRoot(root, enclosing.repo))) {
		return json(
			{ ok: false, error: { code: 'outside-workspace', message: 'the repo path is not inside the workspace root' } },
			{ status: 403 }
		);
	}

	try {
		const head = await gitFileHead(enclosing.repo, enclosing.rel);
		return json({ ok: true, enabled: true, head });
	} catch (err) {
		if (err instanceof GitUnavailableError) {
			return json({ ok: false, code: 'git-unavailable', message: err.message });
		}
		return json(
			{ ok: false, error: { code: 'head-failed', message: err instanceof Error ? err.message : 'head read failed' } },
			{ status: statusFor(err) }
		);
	}
};
