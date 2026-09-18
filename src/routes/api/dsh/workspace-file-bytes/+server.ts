/**
 * api-dsh — GET /api/dsh/workspace-file-bytes?sessionId=…&path=…
 *
 * Binary workspace file read (2026-09-10): images and other non-text
 * files refused by workspaceFiles/read (workspace-file/not-text) read
 * through workspaceFiles/readBytes — base64 byte windows on the wire,
 * paged here until eof and re-joined into one binary Response the
 * browser renders with an <img> element. Refusal mapping follows the
 * workspace-file route: not-found → 404, outside-workspace → 403,
 * not-regular-file → 415, other DshRpcError → 502, transport → 503.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { DshRpcError, mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

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

/** Byte window per readBytes call — bounded so one huge file cannot
 *  balloon the response; the window count cap below is the real bound. */
const WINDOW_BYTES = 512 * 1024;
/** 64 windows × 512 KiB = the 32 MiB per-request ceiling. */
const MAX_WINDOWS = 64;

const MIME_BY_EXT = (path: string): string | null => {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	return IMAGE_MIME[ext] ?? null;
};

/** Refusal code → HTTP status, identical to the workspace-file route. */
const REFUSAL_STATUS: Record<string, number> = {
	'workspace-file/not-found': 404,
	'workspace-file/outside-workspace': 403,
	'workspace-file/not-regular-file': 415
};

export const GET: RequestHandler = async ({ url }) => {
	const sessionId = url.searchParams.get('sessionId');
	if (sessionId === null || sessionId.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-session', message: 'sessionId is required' } },
			{ status: 400 }
		);
	}
	const path = url.searchParams.get('path');
	if (path === null || path.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-path', message: 'path is required' } },
			{ status: 400 }
		);
	}
	const mime = MIME_BY_EXT(path);
	if (mime === null) {
		return json(
			{ ok: false, error: { code: 'bad-ext', message: 'not a previewable image extension' } },
			{ status: 415 }
		);
	}

	try {
		const conn = getDshConnection();
		// Address the workspace RPC at the session's ROOT owner — sub-agent
		// session ids are refused by the host (2026-09-10 fix).
		const owner = await conn.workspaceOwnerSessionId(sessionId);
		const chunks: Buffer[] = [];
		let offset = 0;
		for (let window = 0; window < MAX_WINDOWS; window++) {
			const page = await conn.readWorkspaceFileBytes(owner, path, {
				offset,
				length: WINDOW_BYTES
			});
			const buf = Buffer.from(page.data, 'base64');
			if (buf.length > 0) chunks.push(buf);
			if (page.eof) {
				const body = Buffer.concat(chunks);
				return new Response(new Uint8Array(body), {
					headers: { 'content-type': mime, 'cache-control': 'no-store' }
				});
			}
			offset += buf.length; // decoded bytes, never the base64 length
		}
		return json(
			{ ok: false, error: { code: 'too-many-windows', message: 'file exceeds the preview ceiling' } },
			{ status: 413 }
		);
	} catch (err) {
		if (err instanceof DshRpcError) {
			const mapped = REFUSAL_STATUS[err.code];
			if (mapped !== undefined) return json(mapRpcFailure(err), { status: mapped });
		}
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
