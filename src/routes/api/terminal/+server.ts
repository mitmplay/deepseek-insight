/**
 * /api/terminal — open and list (spec 2026-09-24 Wave 3, task 3.1).
 *
 * The resolve(request): Spec step lives here (ADR D3): the seam applies no
 * defaults, so this route fills every spec field from the operator's
 * terminal config and the explicit request before the registry spawns
 * anything. The whole surface is gated by terminal.enabled — a disabled
 * flag answers NOT_ENABLED and the floor renders nothing.
 */
import { homedir } from 'node:os';

import { json } from '@sveltejs/kit';

import { readTerminalConfig } from '$lib/server/insight-config.js';
import { terminalRegistry } from '$lib/server/terminal/registry.js';
import type { TerminalSpec } from '$lib/server/terminal/types.js';

export const GET = (): Response => {
	const cfg = readTerminalConfig();
	return json({ enabled: cfg.enabled, maxSessions: cfg.maxSessions, sessions: terminalRegistry.list() });
};

interface OpenBody {
	cwd?: string;
	rows?: number;
	cols?: number;
}

function intInRange(v: unknown, min: number, max: number, fallback: number): number {
	return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

/** resolve(request): Spec — the owning defaulting step. Explicit request
 *  values win over operator config floors; the seam never sees a default. */
function resolveSpec(body: OpenBody, cfg: ReturnType<typeof readTerminalConfig>): TerminalSpec {
	const shell = process.env.SHELL || '/bin/bash';
	return {
		argv: [shell, '-l'],
		cwd: typeof body.cwd === 'string' && body.cwd.length > 0 ? body.cwd : homedir(),
		rows: intInRange(body.rows, 2, 200, 24),
		cols: intInRange(body.cols, 2, 500, 80),
		terminalType: 'xterm-256color',
		graceMs: cfg.graceMs,
		idleMs: cfg.idleMs,
		tailBytes: cfg.tailBytes,
		env: undefined
	};
}

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
	const cfg = readTerminalConfig();
	if (!cfg.enabled) return json({ error: 'NOT_ENABLED' }, { status: 403 });
	// The Terminal Desk (ADR 2026-09-24, D6): the resource valve lives where
	// the PTYs live — the desk can only render the refusal, never lift it.
	if (terminalRegistry.list().filter((s) => !s.exited).length >= cfg.maxSessions) {
		return json({ error: 'MAX_SESSIONS' }, { status: 429 });
	}
	let body: OpenBody = {};
	try {
		body = (await request.json()) as OpenBody;
	} catch {
		body = {};
	}
	const { session, token } = terminalRegistry.create(resolveSpec(body, cfg));
	return json({
		sessionId: session.id,
		token,
		fromByte: 0,
		totalBytes: session.streamBytes()
	});
};
