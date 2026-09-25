/**
 * api-dsh — GET /api/dsh/session/[sessionId]/changes (Edited-Files Card,
 * 2026-09-25 — ADR The Edited-Files Card D2; Transport Probe note names the
 * arm: the Host's authenticated /api/changes.summary route — the SDK does
 * not publish workspaceChanges.summary and the service carries no @Remote).
 *
 * The wire event carried only { turn }; the card asks THIS route for the
 * summary the Host keeps while its Session lives. Status mapping:
 *   400 bad-params  — sessionId empty, or seq/turn not positive integers
 *   410 unavailable — the Host answered 404 (Session disposed or never
 *                     recorded): the card's degraded-strip signal
 *   502 upstream    — transport failure or a body that fails validation
 * The response body mirrors the Host's served shape — Pick<WorkspaceChangesSummary,
 * 'turn' | 'files' | 'total' | 'added' | 'deleted'> (ui-deliverables changes.ts:30):
 * cwd and snapshot stay Host-side by the Host's own contract.
 */
import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';

import type { RequestHandler } from './$types';

/** One changed-file record the Host serves (WorkspaceChangedFile's served face). */
export interface ChangesFile {
	path: string;
	display: string;
	added: number;
	deleted: number;
	binary?: true;
	oversized?: true;
}

/** The summary fields this route serves — the Host's own served face. */
export interface ChangesSummary {
	turn: number;
	files: ChangesFile[];
	total: number;
	added: number;
	deleted: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeNonNegative(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Structural validation at the wire boundary — the isChangesSummary face
 *  (ui-deliverables changes.ts:65-71), server-side. Module-local: SvelteKit
 *  +server.ts permits only handler exports (the 2026-09-25 500 bug). */
function isChangesSummary(value: unknown): value is ChangesSummary {
	if (!isRecord(value)) return false;
	const { turn, files, total, added, deleted } = value;
	if (!isSafeNonNegative(turn) || !isSafeNonNegative(total) || !isSafeNonNegative(added) || !isSafeNonNegative(deleted)) {
		return false;
	}
	if (!Array.isArray(files)) return false;
	return files.every((f) => {
		if (!isRecord(f)) return false;
		const { path, display, added: a, deleted: d, binary, oversized } = f;
		if (typeof path !== 'string' || path.length === 0) return false;
		if (typeof display !== 'string' || display.length === 0) return false;
		if (!isSafeNonNegative(a) || !isSafeNonNegative(d)) return false;
		if (binary !== undefined && binary !== true) return false;
		if (oversized !== undefined && oversized !== true) return false;
		return true;
	});
}

export const GET: RequestHandler = async ({ params, url }) => {
	const sessionId = params.sessionId;
	const seq = Number(url.searchParams.get('seq'));
	const turn = Number(url.searchParams.get('turn'));
	// Diff arm (2026-09-25, ADR D4 widened by operator request): an `index`
	// query switches the route to the Host's per-file comparison —
	// /api/changes.diff?sessionId=&seq=&index= (ui-deliverables changes.ts:122-124).
	const indexParam = url.searchParams.get('index');
	const index = indexParam === null ? null : Number(indexParam);
	if (indexParam !== null && (!Number.isSafeInteger(index) || (index as number) < 0)) {
		return json(
			{ ok: false, error: { code: 'bad-params', message: 'index must be a non-negative integer' } },
			{ status: 400 }
		);
	}
	if (
		sessionId.length === 0 ||
		!Number.isSafeInteger(seq) ||
		seq < 1 ||
		!Number.isSafeInteger(turn) ||
		turn < 1
	) {
		return json(
			{ ok: false, error: { code: 'bad-params', message: 'sessionId is required; seq and turn must be positive integers' } },
			{ status: 400 }
		);
	}

	let response: Response;
	try {
		// The connection is the per-process transport singleton — the
		// sessionId rides the Host route's query, not the transport.
		// The connection is the per-process transport singleton — the
		// sessionId rides the Host route's query, not the transport.
		const hostPath =
			index === null
				? `/api/changes.summary?sessionId=${encodeURIComponent(sessionId)}&seq=${seq}`
				: `/api/changes.diff?sessionId=${encodeURIComponent(sessionId)}&seq=${seq}&index=${index}`;
		response = await getDshConnection().fetchHostPath(hostPath);
	} catch {
		return json(
			{ ok: false, error: { code: 'upstream', message: 'changes summary transport failed' } },
			{ status: 502 }
		);
	}

	if (response.status === 404) {
		// The Host serves a summary only while its Session lives — the card's
		// degraded-strip signal (ADR D2: never persist, never fake the rest).
		return json(
			{ ok: false, error: { code: 'unavailable', message: 'the summary is no longer available' } },
			{ status: 410 }
		);
	}
	if (!response.ok) {
		return json(
			{ ok: false, error: { code: 'upstream', message: `changes summary HTTP ${response.status}` } },
			{ status: 502 }
		);
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return json(
			{ ok: false, error: { code: 'upstream', message: 'changes summary is not valid JSON' } },
			{ status: 502 }
		);
	}
	if (index !== null) {
		// Diff arm: the served WorkspaceFileDiff is a closed union on kind
		// (workspace-changes types.ts:57-76) — pass it through on the
		// discriminant, refuse anything else.
		if (!isRecord(body) || (body.kind !== 'text' && body.kind !== 'binary' && body.kind !== 'oversized')) {
			return json(
				{ ok: false, error: { code: 'upstream', message: 'changes diff failed validation' } },
				{ status: 502 }
			);
		}
		return json({ ok: true, diff: body });
	}
	if (!isChangesSummary(body)) {
		return json(
			{ ok: false, error: { code: 'upstream', message: 'changes summary failed validation' } },
			{ status: 502 }
		);
	}
	return json({ ok: true, summary: body });
};
