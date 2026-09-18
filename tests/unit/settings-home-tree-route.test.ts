/**
 * settings-home tree route (Settings Tree ADR 2026-09-18, D2) — GET
 * /api/settings-home/tree, one directory level of a settings home:
 *   - forwards {home, path} with absent path defaulting to '' (the root);
 *   - an unknown home rejects 400 before any listing;
 *   - a containment refusal maps 400; ENOENT maps 404; anything else is
 *     a 500 with the reason.
 * The fs-backed module is mocked at the seam (the established
 * workspace-tree-route.test.ts pattern).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listSpy } = vi.hoisted(() => ({ listSpy: vi.fn() }));

vi.mock('$lib/server/settings-home.js', () => ({
	// A REAL class so 'instanceof SettingsHomeRefusal' is honest.
	SettingsHomeRefusal: class SettingsHomeRefusal extends Error {
		constructor(
			public readonly code: string,
			message: string
		) {
			super(message);
		}
	},
	isSettingsHome: (v: unknown) => v === 'dsi' || v === 'dsh',
	listSettingsHomeDir: listSpy
}));

import { GET } from '../../src/routes/api/settings-home/tree/+server';

function get(query: string): Promise<Response> {
	return GET({ url: new URL('http://localhost/api/settings-home/tree' + query) } as never) as Promise<Response>;
}

const LISTING = { entries: [{ name: 'AGENTS.md', type: 'file' }], truncated: false };

beforeEach(() => {
	listSpy.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET /api/settings-home/tree (Settings Tree ADR D2)', () => {
	it('forwards {home, path} — absent path lists the root as \'\'', async () => {
		listSpy.mockResolvedValueOnce(LISTING);
		const res = await get('?home=dsi');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, listing: LISTING });
		expect(listSpy).toHaveBeenCalledExactlyOnceWith('dsi', '');
	});

	it('forwards the nested relative path verbatim', async () => {
		listSpy.mockResolvedValueOnce({ ...LISTING });
		await get('?home=dsh&path=' + encodeURIComponent('docs/sub dir'));
		expect(listSpy).toHaveBeenCalledWith('dsh', 'docs/sub dir');
	});

	it('rejects an unknown home with 400 before any listing', async () => {
		const res = await get('?home=x&path=a');
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('bad-home');
		expect(listSpy).not.toHaveBeenCalled();
	});

	it('maps a containment refusal to 400 with its code verbatim', async () => {
		listSpy.mockRejectedValueOnce(new (await import('$lib/server/settings-home.js')).SettingsHomeRefusal('bad-path', 'escapes'));
		const res = await get('?home=dsi&path=../../etc');
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe('bad-path');
		expect(body.error.message).toBe('escapes');
	});

	it('maps ENOENT to 404 not-found', async () => {
		listSpy.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'ENOENT' }));
		const res = await get('?home=dsi&path=gone');
		expect(res.status).toBe(404);
		expect((await res.json()).error.code).toBe('not-found');
	});

	it('maps any other failure to 500 io-error with the reason', async () => {
		listSpy.mockRejectedValueOnce(new Error('EACCES: bad perms'));
		const res = await get('?home=dsi&path=x');
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('io-error');
	});
});
