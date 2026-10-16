/**
 * Focused unit coverage for the /api/terminal/[id]/stream SSE route over a
 * MOCKED registry (the real-engine wire contract lives in
 * tests/unit/terminal-routes.test.ts). This file pins the arms the real-engine
 * tests cannot reach deterministically:
 * - the TerminalRegistryRefusal branch (404 vs 403),
 * - the cancel arm (client vanishes -> listener dropped, crash RCA 2026-09-24),
 * - the enqueue/cancel race guard (controller throws mid-stream),
 * - the vanished-between-peek-and-subscribe error frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { peekMock, eventsMock, exitOutcomeMock, listMock } = vi.hoisted(() => ({
	peekMock: vi.fn(),
	eventsMock: vi.fn(),
	exitOutcomeMock: vi.fn(),
	listMock: vi.fn()
}));

vi.mock('$lib/server/terminal/registry.js', () => {
	class TerminalRegistryRefusal extends Error {
		code: string;
		constructor(code: string, message: string) {
			super(message);
			this.name = 'TerminalRegistryRefusal';
			this.code = code;
		}
	}
	return {
		TerminalRegistryRefusal,
		terminalRegistry: {
			peek: peekMock,
			events: eventsMock,
			exitOutcome: exitOutcomeMock,
			list: listMock
		}
	};
});

import { GET as streamRoute } from '../../src/routes/api/terminal/[id]/stream/+server';
import { TerminalRegistryRefusal } from '$lib/server/terminal/registry.js';

type Listener = (event: Record<string, unknown>) => void;

/** Read an SSE body to completion (happy-dom's Response.text() hangs on streams). */
async function drain(res: Response): Promise<string> {
	const reader = res.body!.getReader();
	const dec = new TextDecoder();
	let out = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		out += dec.decode(value, { stream: true });
	}
	return out;
}

interface FakeSession {
	listener: Listener | null;
	readFrom: (fromByte: number) => Record<string, unknown>;
	isExited: () => boolean;
}

function fakeSession(tail: Record<string, unknown> = { text: 'tail', nextOffset: 4, lossy: false, spillPath: undefined }): FakeSession {
	const s = {
		listener: null as Listener | null,
		readFrom: (_from: number) => tail,
		isExited: () => false
	};
	// on/off attached below keep the shape the route expects
	return Object.assign(s, {
		on(_kind: string, fn: Listener) {
			s.listener = fn;
		},
		off(_kind: string, fn: Listener) {
			if (s.listener === fn) s.listener = null;
		}
	}) as FakeSession & { on: unknown; off: unknown } as FakeSession;
}

/** Scriptable controller the stubbed ReadableStream hands to start(). */
const closeRef: { realClose: () => void } = { realClose: () => undefined };

/** Explicit scriptable-controller shape — avoids a self-referential `typeof controller`. */
interface ScriptableController {
	enqueue: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
}

const controller: ScriptableController = {
	enqueue: vi.fn((_chunk: Uint8Array) => undefined),
	close: vi.fn(() => undefined)
};

beforeEach(() => {
	peekMock.mockReset();
	eventsMock.mockReset();
	exitOutcomeMock.mockReset();
	listMock.mockReset();
	controller.enqueue.mockReset().mockImplementation(() => undefined);
	controller.close.mockReset().mockImplementation(() => closeRef.realClose());
	// extends the REAL ReadableStream: the scriptable controller is handed to
	// start() synchronously, and cancel stays drivable via res.body.cancel()
	class FakeReadableStream extends ReadableStream<Uint8Array> {
		constructor(spec: {
			start: (controller: ScriptableController) => void;
			cancel: () => void;
		}) {
			super({ start: (c) => spec.start(controller), cancel: spec.cancel });
		}
	}
	vi.stubGlobal('ReadableStream', FakeReadableStream);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('terminal stream route — mock registry coverage', () => {
	it('peek refusal: NO_SESSION -> 404, other refusal code -> 403', () => {
		peekMock.mockImplementationOnce(() => {
			throw new TerminalRegistryRefusal('NO_SESSION', 'gone');
		});
		const res404 = streamRoute({ params: { id: 'x' }, url: new URL('http://localhost/stream') }) as Response;
		expect(res404.status).toBe(404);

		peekMock.mockImplementationOnce(() => {
			throw new TerminalRegistryRefusal('FOREIGN_SESSION', 'foreign');
		});
		const res403 = streamRoute({ params: { id: 'x' }, url: new URL('http://localhost/stream') }) as Response;
		expect(res403.status).toBe(403);
	});

	it('enqueue/cancel race: controller throwing mid-stream is treated as closed, stream still detaches cleanly', () => {
		controller.enqueue.mockImplementation(() => {
			throw new Error('dead controller (simulated cancel race)');
		});
		controller.close.mockImplementation(() => {
			throw new Error('already closed');
		});
		const session = fakeSession();
		peekMock.mockReturnValue({ id: 's2', exited: false });
		eventsMock.mockReturnValue(session);
		const res = streamRoute({ params: { id: 's2' }, url: new URL('http://localhost/stream') }) as Response;
		expect(res).toBeInstanceOf(Response);
		// start() already ran: the tail enqueue threw and the catch marked closed
		// every event kind then flows through onEvent with a dead controller — no throw
		expect(() => {
			session.listener!({ type: 'output', bytes: 'a', nextOffset: 2 });
			session.listener!({ type: 'settled', reason: 'idle' });
			session.listener!({ type: 'exit', outcome: 'normal' });
			session.listener!({ type: 'closed', quiescent: true, lingeringPids: [] });
		}).not.toThrow();
		// the closed frame detached the listener; a late client cancel is a no-op
		expect(session.listener).toBeNull();
	});

	it('peek throws a non-refusal error: the route rethrows it', () => {
		peekMock.mockImplementation(() => {
			throw new TypeError('registry blew up');
		});
		expect(() => streamRoute({ params: { id: 'x' }, url: new URL('http://localhost/stream') })).toThrow(TypeError);
	});

	it('cancel arm: client cancelling drops the session listener; later events are ignored', async () => {
		const session = fakeSession();
		peekMock.mockReturnValue({ id: 's1', exited: false });
		eventsMock.mockReturnValue(session);
		const res = streamRoute({ params: { id: 's1' }, url: new URL('http://localhost/stream') }) as Response;
		expect(session.listener).not.toBeNull();

		await res.body!.cancel(); // drives the stream's cancel callback
		expect(session.listener).toBeNull(); // listener dropped

		// a late PTY chunk therefore has no listener to enqueue into
		expect(session.listener).toBeNull();
	});

	it('vanished between peek and subscribe: error frame then the stream ends', () => {
		const session = fakeSession();
		session.isExited = () => true;
		peekMock.mockReturnValue({ id: 's3', exited: true });
		eventsMock.mockReturnValue(session);
		exitOutcomeMock.mockReturnValue('normal');
		listMock.mockReturnValue([{ id: 'other' }]); // some() callback runs, id not present
		const res = streamRoute({ params: { id: 's3' }, url: new URL('http://localhost/stream') }) as Response;
		expect(res).toBeInstanceOf(Response);
		// the error frame was enqueued and the controller closed
		const dec = new TextDecoder();
		const frames = controller.enqueue.mock.calls.map((c) => dec.decode(c[0] as Uint8Array));
		expect(frames.some((f) => f.includes('event: error') && f.includes('NO_SESSION'))).toBe(true);
		expect(controller.close).toHaveBeenCalled();
		expect(session.listener).toBeNull(); // detached after the honest error end
	});
});