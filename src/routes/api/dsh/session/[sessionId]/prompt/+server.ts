/**
 * api-dsh — POST /api/dsh/session/[sessionId]/prompt
 *
 * Body {text, images?} → session.prompt content parts (task 2.3): images
 * first, text last (buildPromptContent). Text-or-images: an attachments-
 * only send passes with empty text; neither is a 400. Image parts are
 * shape-validated against the wire whitelist here — canonical base64 and
 * limits remain the HOST's admission (the proxy passes originals through
 * the receipt boundary, ADR D4). Returns after the receipt only (BC-3):
 * {accepted:true} or an RPC error (e.g. agent-busy → 502, mapped by the
 * client into a banner + input unlock).
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { buildPromptContent, isPromptImageMediaType, mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';
import type { PromptImagePart } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	const sessionId = params.sessionId;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(
			{ ok: false, error: { code: 'bad-json', message: 'request body is not valid JSON' } },
			{ status: 400 }
		);
	}

	const record = (body as { text?: unknown; images?: unknown } | null) ?? {};
	const text = record.text ?? '';
	const rawImages = record.images;

	if (typeof text !== 'string') {
		return json(
			{ ok: false, error: { code: 'bad-text', message: 'text must be a string' } },
			{ status: 400 }
		);
	}

	let images: PromptImagePart[] = [];
	if (rawImages !== undefined) {
		if (!Array.isArray(rawImages)) {
			return json(
				{ ok: false, error: { code: 'invalid-images', message: 'images must be an array' } },
				{ status: 400 }
			);
		}
		for (const candidate of rawImages) {
			const image = candidate as { mediaType?: unknown; data?: unknown; name?: unknown } | null;
			if (
				image === null ||
				typeof image !== 'object' ||
				typeof image.mediaType !== 'string' ||
				!isPromptImageMediaType(image.mediaType) ||
				typeof image.data !== 'string' ||
				image.data.length === 0 ||
				(image.name !== undefined && typeof image.name !== 'string')
			) {
				return json(
					{
						ok: false,
						error: { code: 'invalid-images', message: 'each image needs a whitelisted mediaType and non-empty base64 data' }
					},
					{ status: 400 }
				);
			}
			images.push({
				type: 'image',
				mediaType: image.mediaType,
				data: image.data,
				...(image.name === undefined ? {} : { name: image.name })
			});
		}
	}

	if (text.trim().length === 0 && images.length === 0) {
		return json(
			{ ok: false, error: { code: 'empty-text', message: 'text or at least one image is required' } },
			{ status: 400 }
		);
	}

	try {
		const receipt = await getDshConnection().prompt(sessionId, buildPromptContent(text, images));
		return json({ ok: true, accepted: receipt.accepted === true });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
