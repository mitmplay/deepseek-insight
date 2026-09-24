/**
 * /api/terminal/[id]/stream — the SSE downstream (Wave 3, task 3.2).
 *
 * Frames: output (byte-offset deltas with lossy + spillPath), settled,
 * exit, closed, error. Watching is the open path (no token — ADR D7);
 * the stream ends after closed. fromByte resumes a late attacher from the
 * ring tail; a slid-out offset reports lossy and names the spill.
 * X-Accel-Buffering: no keeps reverse proxies from buffering the stream.
 */
import { json } from '@sveltejs/kit';

import { terminalRegistry, TerminalRegistryRefusal } from '$lib/server/terminal/registry.js';
import type { TerminalSessionEvent } from '$lib/server/terminal/types.js';

const SSE_HEADERS: Record<string, string> = {
	'content-type': 'text/event-stream',
	'cache-control': 'no-store',
	connection: 'keep-alive',
	'x-accel-buffering': 'no'
};

function sseFrame(event: string, data: unknown): string {
	return 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
}

export const GET = (ctx: { params: { id: string }; url: URL }): Response => {
	const id = ctx.params.id;
	try {
		terminalRegistry.peek(id);
	} catch (err) {
		if (err instanceof TerminalRegistryRefusal) return json({ error: err.code }, { status: err.code === 'NO_SESSION' ? 404 : 403 });
		throw err;
	}
	const fromByteRaw = Number(ctx.url.searchParams.get('fromByte') ?? '0');
	const fromByte = Number.isFinite(fromByteRaw) && fromByteRaw >= 0 ? fromByteRaw : 0;

	const session = terminalRegistry.events(id);
	if (!session) return json({ error: 'NO_SESSION' }, { status: 404 });

	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			const enqueue = (chunk: string) => {
				if (!closed) controller.enqueue(encoder.encode(chunk));
			};

			// Tail first, then live deltas — one attach, no gap.
			const read = session.readFrom(fromByte);
			enqueue(sseFrame('output', { text: read.text, nextOffset: read.nextOffset, lossy: read.lossy, spillPath: read.spillPath }));

			const onEvent = (event: TerminalSessionEvent) => {
				if (event.type === 'output') {
					// Live chunks flow through the same ring; the session emits
					// bytes, we trust the offset it published.
					enqueue(sseFrame('output', { text: event.bytes, nextOffset: event.nextOffset, lossy: false }));
					return;
				}
				if (event.type === 'settled') {
					enqueue(sseFrame('settled', { reason: event.reason }));
					return;
				}
				if (event.type === 'exit') {
					enqueue(sseFrame('exit', { outcome: event.outcome }));
					return;
				}
				if (event.type === 'closed') {
					enqueue(sseFrame('closed', { quiescent: event.quiescent, lingeringPids: event.lingeringPids }));
					closed = true;
					session.off('event', onEvent);
					controller.close();
				}
			};
			session.on('event', onEvent);

			if (session.isExited() && terminalRegistry.exitOutcome(id) !== null && !terminalRegistry.list().some((s) => s.id === id)) {
				// session vanished between peek and subscribe — end honestly
				enqueue(sseFrame('error', { error: 'NO_SESSION' }));
				closed = true;
				controller.close();
			}
		}
	});

	return new Response(stream, { headers: SSE_HEADERS });
};
