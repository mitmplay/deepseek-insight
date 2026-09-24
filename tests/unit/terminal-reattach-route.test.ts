/**
 * Reattach route tests (The Surviving Shell task 1.1-T): the thin POST
 * over terminalRegistry.reattach — fresh token + byte tail on success,
 * old token evicted (the fence refuses it), NO_SESSION as 404.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reattachSpy, registry } = vi.hoisted(() => {
	const reattachSpy = vi.fn();
	const registry = {
		reattach: reattachSpy,
		send: vi.fn(() => { throw new Error('unused in these tests'); })
	};
	return { reattachSpy, registry };
});

vi.mock('$lib/server/terminal/registry.js', () => ({
	terminalRegistry: registry,
	TerminalRegistryRefusal: class TerminalRegistryRefusal extends Error {
		constructor(public code: 'NO_SESSION' | 'FOREIGN_SESSION') {
			super(code);
		}
	}
}));

import { POST } from '../../src/routes/api/terminal/[id]/reattach/+server';

function post(id: string): Response {
	return POST({ params: { id } } as never) as Response;
}

beforeEach(() => {
	reattachSpy.mockReset();
});

describe('POST /api/terminal/[id]/reattach', () => {
	it('returns a fresh token and the byte tail on success', async () => {
		reattachSpy.mockReturnValueOnce({ token: 't2', fromByte: 4096 });
		const res = post('s1');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { token: string; fromByte: number };
		expect(body).toEqual({ token: 't2', fromByte: 4096 });
		expect(reattachSpy).toHaveBeenCalledWith('s1');
	});

	it('re-mints on every call — each reattach delegates with the session id', async () => {
		reattachSpy.mockReturnValueOnce({ token: 't2', fromByte: 0 });
		reattachSpy.mockReturnValueOnce({ token: 't3', fromByte: 512 });
		const first = (await (post('s1') as Response).json()) as { token: string };
		const second = (await (post('s1') as Response).json()) as { token: string };
		expect(first.token).toBe('t2');
		expect(second.token).toBe('t3');
		expect(reattachSpy).toHaveBeenNthCalledWith(2, 's1');
	});

	it('refuses an unknown session with 404 NO_SESSION', async () => {
		const { TerminalRegistryRefusal } = await import('$lib/server/terminal/registry.js');
		reattachSpy.mockImplementationOnce(() => {
			throw new (TerminalRegistryRefusal as new (c: 'NO_SESSION') => Error)('NO_SESSION');
		});
		const res = post('ghost');
		expect(res.status).toBe(404);
		expect((await res.json()).error).toBe('NO_SESSION');
	});
});
