/**
 * api-dsh — GET /api/dsh/workspace-file-bytes?root=…&path=…
 *
 * Binary workspace file read for previews (2026-09-10): images are refused
 * by workspaceFiles/read (workspace-file/not-text), so the <img> element
 * loads this route directly.
 *
 * 2026-09-28 — the read is a PLAIN FILESYSTEM read. A DSI workspace is a
 * path into the same filesystem this process already sees; a read-only GET
 * gained nothing from the DSH RPC hop (readBytes) it used before, and it
 * coupled the preview to the host's wire contract (which changed under it:
 * range → options + multipart receipts, 0.1.7-rc.2 — the tab went broken
 * without a single DSI commit). Containment is enforced locally: the
 * resolved target must stay inside the workspace root. Refusals:
 * bad-root/bad-path → 400, outside-workspace → 403, not-found → 404,
 * bad-ext/not-regular-file → 415, over-ceiling → 413.
 */

import { json } from '@sveltejs/kit';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { RequestHandler } from './$types';

/** The extensions DSI previews as images; anything else refuses 415. */
const IMAGE_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	avif: 'image/avif'
};

/** Per-request ceiling (the old 64×512 KiB readBytes window bound). */
const MAX_BYTES = 32 * 1024 * 1024;

const MIME_BY_EXT = (p: string): string | null => {
	const ext = p.split('.').pop()?.toLowerCase() ?? '';
	return IMAGE_MIME[ext] ?? null;
};

const refuse = (status: number, code: string, message: string): Response =>
	json({ ok: false, error: { code, message } }, { status });

export const GET: RequestHandler = async ({ url }) => {
	const root = url.searchParams.get('root');
	if (root === null || root.trim().length === 0) {
		return refuse(400, 'bad-root', 'root is required');
	}
	const rel = url.searchParams.get('path');
	if (rel === null || rel.trim().length === 0) {
		return refuse(400, 'bad-path', 'path is required');
	}
	const mime = MIME_BY_EXT(rel);
	if (mime === null) {
		return refuse(415, 'bad-ext', 'not a previewable image extension');
	}

	// Containment is the whole security contract: the resolved target must
	// stay inside the workspace root — a ".." walk is refused 403, exactly
	// like the settings-home file read.
	const rootAbs = path.resolve(root);
	const target = path.resolve(rootAbs, rel);
	if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) {
		return refuse(403, 'outside-workspace', 'path escapes the workspace root');
	}

	let info;
	try {
		info = await stat(target);
	} catch {
		return refuse(404, 'workspace-file/not-found', 'no entry at "' + rel + '"');
	}
	if (!info.isFile()) {
		return refuse(415, 'workspace-file/not-regular-file', 'not a regular file');
	}
	if (info.size > MAX_BYTES) {
		return refuse(413, 'too-large', 'file exceeds the preview ceiling');
	}

	try {
		const body = await readFile(target);
		return new Response(new Uint8Array(body), {
			headers: { 'content-type': mime, 'cache-control': 'no-store' }
		});
	} catch {
		return refuse(404, 'workspace-file/not-found', 'no entry at "' + rel + '"');
	}
};
