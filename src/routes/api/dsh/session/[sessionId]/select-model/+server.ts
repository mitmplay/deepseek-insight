/**
 * api-dsh — POST /api/dsh/session/[sessionId]/select-model  (POC-3 W3, task 3.2)
 *
 * Body {provider, model, reasoningEffort?} → session.selectModel. Returns
 * {ok:true, selected} with the host's normalized selection. Catalog
 * membership is advisory host-side; an invalid effort fails as an RpcError
 * (→ 502 with the host code). Subagents reject `agent-busy` the same way.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

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

	const { provider, model, reasoningEffort } = (body ?? {}) as {
		provider?: unknown;
		model?: unknown;
		reasoningEffort?: unknown;
	};
	if (typeof provider !== 'string' || provider.length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-provider', message: 'provider must be a non-empty string' } },
			{ status: 400 }
		);
	}
	if (typeof model !== 'string' || model.length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-model', message: 'model must be a non-empty string' } },
			{ status: 400 }
		);
	}
	if (reasoningEffort !== undefined && typeof reasoningEffort !== 'string') {
		return json(
			{ ok: false, error: { code: 'bad-reasoningEffort', message: 'reasoningEffort must be a string when present' } },
			{ status: 400 }
		);
	}

	try {
		const selected = await getDshConnection().selectModel(
			sessionId,
			provider,
			model,
			reasoningEffort
		);
		return json({ ok: true, selected });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
