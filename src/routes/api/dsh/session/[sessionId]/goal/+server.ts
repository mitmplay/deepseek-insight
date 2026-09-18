/**
 * api-dsh — POST /api/dsh/session/[sessionId]/goal (Goal Bar, 2026-09-08)
 *
 * The Goal Bar's actions ride the host's Goal Remotes — `goals/pause`,
 * `goals/resume`, `goals/clear` — the SAME verbs DSH's own web client
 * injects, NOT `commands/execute`: the web plane's catalog deliberately
 * excludes `command-goal` (packages/bundle/web-app/cordis.patch.yml), so a
 * `/goal` line is an admission miss there (probed live 2026-09-08:
 * "unknown command: /goal — nothing was sent").
 *
 * Body: { verb: 'pause'|'resume'|'clear'|'edit', ref: {id, revision},
 * edit?: { objective?, maxGoalRounds? } } — the ref is the CAS identity the
 * host demands; edit carries its changed-fields payload (2026-09-09). While a goal is actively rounding,
 * the round driver (fencing pauses) and the model's own update_goal are
 * also writers, so the operator's ref can go stale between render and
 * click through no fault of the click.
 *
 * The connection's rpc (dsh-rpc.ts parseResponse) UNWRAPS successes to the
 * bare payload (a GoalView / GoalRef — no ok field) and folds every failure
 * shape into a thrown DshRpcError, so at this layer:
 *   - a resolved attempt IS success (2026-09-08 fix: the route used to read
 *     result.ok on the unwrapped value and reported every success as
 *     goal-refused — the goal changed while the banner claimed refusal);
 *   - a stale-ref refusal is the DshRpcError whose message ends
 *     "… revision N". ONE retry runs with the host-named revision, or the
 *     connection's freshest projection revision when the message form
 *     changes. A second refusal is a real race and is returned as-is.
 * Wire/RpcError (transport, phase-transition) → mapRpcFailure/statusFor.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { goalFromProjection } from '$lib/services/conversation/goal-projection';
import { DshRpcError, mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

type GoalVerb = 'pause' | 'resume' | 'clear' | 'edit';
const VERBS: readonly GoalVerb[] = ['pause', 'resume', 'clear', 'edit'];

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

	const b = body as { verb?: unknown; ref?: { id?: unknown; revision?: unknown } } | null;
	const verb = b?.verb;
	const ref = b?.ref;
	if (typeof verb !== 'string' || !VERBS.includes(verb as GoalVerb)) {
		return json(
			{ ok: false, error: { code: 'bad-verb', message: 'verb must be pause, resume, clear, or edit (v2 retry)' } },
			{ status: 400 }
		);
	}
	if (
		ref === null ||
		typeof ref !== 'object' ||
		typeof ref.id !== 'string' ||
		ref.id.length === 0 ||
		typeof ref.revision !== 'number' ||
		!Number.isInteger(ref.revision)
	) {
		return json(
			{ ok: false, error: { code: 'bad-ref', message: 'ref must be {id: string, revision: integer}' } },
			{ status: 400 }
		);
	}

	// Edit payload (ADR "The Goal Editor" D1/D3): at least one changed field,
	// mirroring the host's EditGoalRequest contract — objective is a non-empty
	// string (the host trims), maxGoalRounds a positive safe integer. Other
	// verbs carry no payload.
	let editFields: { objective?: string; maxGoalRounds?: number } | undefined;
	if (verb === 'edit') {
		const e = (b as { edit?: unknown }).edit;
		const rec =
			e !== null && typeof e === 'object' && !Array.isArray(e)
				? (e as { objective?: unknown; maxGoalRounds?: unknown })
				: undefined;
		const objectiveOk =
			rec?.objective === undefined ||
			(typeof rec.objective === 'string' && rec.objective.trim().length > 0);
		const roundsOk =
			rec?.maxGoalRounds === undefined ||
			(typeof rec.maxGoalRounds === 'number' && Number.isSafeInteger(rec.maxGoalRounds) && rec.maxGoalRounds >= 1);
		const atLeastOne = rec !== undefined && (rec.objective !== undefined || rec.maxGoalRounds !== undefined);
		if (!objectiveOk || !roundsOk || !atLeastOne) {
			return json(
				{ ok: false, error: { code: 'bad-edit', message: 'edit requires objective (non-empty string) and/or maxGoalRounds (positive integer)' } },
				{ status: 400 }
			);
		}
		editFields = {
			...(typeof rec.objective === 'string' ? { objective: rec.objective } : {}),
			...(typeof rec.maxGoalRounds === 'number' ? { maxGoalRounds: rec.maxGoalRounds } : {})
		};
	}

	const refId: string = ref.id;
	const attempt = (revision: number): Promise<unknown> =>
		getDshConnection().goalVerb(verb as GoalVerb, sessionId, { id: refId, revision }, editFields);
	const freshestProjectionRevision = (): number | null => {
		const fresh = goalFromProjection(getDshConnection().projectionValue(sessionId, 'goal'));
		return fresh !== null && fresh !== undefined && fresh.id === refId ? fresh.revision : null;
	};

	try {
		return json({ ok: true, value: await attempt(ref.revision) });
	} catch (err) {
		if (err instanceof DshRpcError) {
			// Stale-ref retry — the thrown refusal names the host's current
			// revision; fall back to the freshest projection revision.
			if (/stale goal ref/i.test(err.message)) {
				const named = /revision (\d+)"?\s*;?\s*$/.exec(err.message);
				const retryRevision = named !== null ? Number(named[1]) : freshestProjectionRevision();
				if (retryRevision !== null && retryRevision !== ref.revision) {
					try {
						return json({ ok: true, value: await attempt(retryRevision) });
					} catch {
						// fall through to the honest refusal below
					}
				}
			}
			return json({ ok: false, error: { code: err.code, message: err.message } }, { status: 409 });
		}
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
