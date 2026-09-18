/**
 * api-workspace — POST /api/workspace/file-write
 *
 * The File Eye's direct save (ADR The File Eye 2026-09-12, D4): on a
 * full-access desk the DSI server writes the bytes ITSELF — fresh gate,
 * realpath containment of the target inside the workspace root, then
 * fs.writeFile. The written receipt IS proof of effect (unlike the
 * retired delegated turn). Every refusal happens BEFORE the filesystem
 * is touched.
 */
import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';
import { json } from '@sveltejs/kit';

import { gitGateEnabled, isInsideRoot } from '$lib/server/git-probe';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(
			{ ok: false, error: { code: 'bad-json', message: 'request body is not valid JSON' } },
			{ status: 400 }
		);
	}

	const record = (body as { sessionId?: unknown; root?: unknown; path?: unknown; content?: unknown } | null) ?? {};
	const { sessionId, root, path, content } = record;
	if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
		return json({ ok: false, error: { code: 'bad-session', message: 'sessionId is required' } }, { status: 400 });
	}
	if (typeof root !== 'string' || root.trim().length === 0) {
		return json({ ok: false, error: { code: 'bad-root', message: 'root is required' } }, { status: 400 });
	}
	if (typeof path !== 'string' || path.length === 0) {
		return json({ ok: false, error: { code: 'bad-path', message: 'path is required' } }, { status: 400 });
	}
	if (typeof content !== 'string') {
		return json({ ok: false, error: { code: 'bad-content', message: 'content must be a string' } }, { status: 400 });
	}

	let enabled: boolean;
	try {
		enabled = await gitGateEnabled(sessionId);
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
	if (!enabled) {
		return json(
			{ ok: false, error: { code: 'gate-closed', message: 'the desk does not permit direct writes' } },
			{ status: 403 }
		);
	}

	const absolute = nodePath.join(root, ...path.split('/').filter((p) => p.length > 0));
	if (!(await isInsideRoot(root, absolute))) {
		return json(
			{ ok: false, error: { code: 'outside-workspace', message: 'the file path is not inside the workspace root' } },
			{ status: 403 }
		);
	}

	try {
		await fs.writeFile(absolute, content, 'utf8');
		return json({ ok: true, written: true });
	} catch (err) {
		return json(
			{ ok: false, error: { code: 'write-failed', message: err instanceof Error ? err.message : 'write failed' } },
			{ status: 500 }
		);
	}
};
