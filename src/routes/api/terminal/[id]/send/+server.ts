/**
 * /api/terminal/[id]/send — the tokened action dispatcher (Wave 3, 3.1).
 * write | signal | close. The registry owns the fence; refusals surface as
 * their stable codes (SEND_ACTIVE rides the write path as 409).
 */
import { json } from '@sveltejs/kit';

import { terminalRegistry, TerminalRegistryRefusal } from '$lib/server/terminal/registry.js';
import { TerminalSendRefusal } from '$lib/server/terminal/session.js';
import type { TerminalSignal } from '$lib/server/terminal/types.js';

interface SendBody {
	token?: string;
	action?: 'write' | 'signal' | 'close';
	data?: string;
	signal?: TerminalSignal;
	timeoutMs?: number;
}

const SIGNALS: readonly string[] = ['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP', 'SIGHUP'];

export const POST = async (ctx: { params: { id: string }; request: Request }): Promise<Response> => {
	let body: SendBody;
	try {
		body = (await ctx.request.json()) as SendBody;
	} catch {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	const id = ctx.params.id;
	const token = typeof body.token === 'string' ? body.token : '';
	try {
		switch (body.action) {
			case 'write': {
				if (typeof body.data !== 'string') return json({ error: 'BAD_REQUEST' }, { status: 400 });
				terminalRegistry.write(id, token, body.data);
				return json({ written: true });
			}
			case 'signal': {
				if (typeof body.signal !== 'string' || !SIGNALS.includes(body.signal)) {
					return json({ error: 'BAD_REQUEST' }, { status: 400 });
				}
				const pgid = terminalRegistry.signal(id, token, body.signal as TerminalSignal);
				return json({ signalled: pgid });
			}
			case 'close': {
				const result = await terminalRegistry.close(id, token);
				return json(result, { status: result.quiescent ? 200 : 500 });
			}
			default:
				return json({ error: 'BAD_REQUEST' }, { status: 400 });
		}
	} catch (err) {
		if (err instanceof TerminalRegistryRefusal) return json({ error: err.code }, { status: err.code === 'NO_SESSION' ? 404 : 403 });
		if (err instanceof TerminalSendRefusal) return json({ error: 'SEND_ACTIVE' }, { status: 409 });
		throw err;
	}
};
