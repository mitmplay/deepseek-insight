/**
 * api-dsh — POST /api/dsh/session/[sessionId]/command (Slash Menu W1, task 1.2)
 *
 * The menu's command-pick and the executor ladder rung share this route: the
 * FULL line goes to commands/execute VERBATIM — the client never re-parses a
 * host command's arguments (ADR §4.4). The permission route's generalization,
 * not its replacement (PRD §4): …/permission keeps its own route.
 *
 * Receipts are honest (PRD §5, Resolved decision 2):
 *   - success            → {ok:true, executed:true, commandId, text?}
 *   - admission miss     → {ok:true, executed:false} — the host admitted no
 *                          command; a NEGATIVE ANSWER, never a 5xx (the RCA
 *                          incident stays impossible: the caller keeps the
 *                          draft and shows an honest note, never a model send)
 *   - command's own error→ {ok:false, code:'command-error', message} — the
 *                          pick landed but the command refused (unknown preset…)
 *   - wire/RpcError      → mapRpcFailure/statusFor (502/503)
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

	const line = (body as { line?: unknown } | null)?.line;
	if (typeof line !== 'string' || line.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'empty-line', message: 'line must be a non-empty string' } },
			{ status: 400 }
		);
	}
	if (!line.startsWith('/')) {
		return json(
			{ ok: false, error: { code: 'not-a-command', message: 'line must start with /' } },
			{ status: 400 }
		);
	}

	try {
		const receipt = await getDshConnection().executeCommand(sessionId, line);
		if (receipt === null) {
			// Admission miss — honest negative, draft kept upstream (ADR §4.3).
			return json({ ok: true, executed: false });
		}
		if (receipt.result.kind === 'error') {
			return json({
				ok: false,
				error: { code: 'command-error', message: receipt.result.text ?? 'the command reported an error' }
			});
		}
		return json({
			ok: true,
			executed: true,
			commandId: receipt.commandId,
			...(receipt.result.text !== undefined ? { text: receipt.result.text } : {})
		});
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
