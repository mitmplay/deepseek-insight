// @vitest-environment node
/**
 * SSR locale middleware — Three Tongues W1 task 1.4-T.
 * One case per ADR state-homes row through the real handle() hook, with
 * the settings document mocked at its seam. Node env is REQUIRED: happy-dom
 * strips the forbidden `cookie` header from Request, so the middleware
 * could never see dsi.locale (probe 2026-09-12 — vitest 4 ignores the
 * config's environmentMatchGlobs, so the docblock is the real switch).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/settings-document', () => ({ readSettingsDocument: vi.fn() }));

import { readSettingsDocument } from '$lib/server/settings-document';
import { handle } from '../../src/hooks.server';

const mockedRead = vi.mocked(readSettingsDocument);

/** Drive handle() with request headers; return the final <html lang=...>. */
async function resolveLang(headers: Record<string, string>): Promise<string> {
	const event: { request: Request } = { request: new Request('http://localhost/', { headers }) };
	let chunkOpts: { transformPageChunk: (o: { html: string }) => string } | undefined;
	// Minimal kit-event harness — cast to the shape handle() actually uses.
	const kitHandle = handle as unknown as (ctx: {
		event: {
			request: Request;
			url: URL;
			cookies: { set: (name: string, value: string, opts: unknown) => void };
		};
		resolve: (
			e: unknown,
			opts: { transformPageChunk: (o: { html: string }) => string }
		) => Promise<string>;
	}) => Promise<string>;
	await kitHandle({
		event: Object.assign(event, {
			url: new URL('http://localhost/'),
			cookies: { set: vi.fn() }
		}),
		resolve: async (_evt, opts) => {
			chunkOpts = opts;
			return '<html lang="%paraglide.locale%"><body>x</body></html>';
		}
	});
	expect(chunkOpts, 'resolve received transformPageChunk').toBeDefined();
	return chunkOpts!.transformPageChunk({ html: '<html lang="%paraglide.locale%">' });
}

	it('a valid cookie blocks the yaml injection entirely (no cookie write)', async () => {
		mockedRead.mockReturnValue({
			text: JSON.stringify({ ui: { locale: 'id' } }),
			missing: false
		} as ReturnType<typeof readSettingsDocument>);
		const cookieSet = vi.fn();
		const event = {
			request: new Request('http://localhost/', { headers: { cookie: 'dsi.locale=zh' } }),
			url: new URL('http://localhost/'),
			cookies: { set: cookieSet }
		};
		const kitHandle = handle as unknown as (ctx: { event: unknown; resolve: (e: unknown, o: unknown) => Promise<string> }) => Promise<string>;
		await kitHandle({
			event,
			resolve: async () => '<html lang="zh">'
		});
		expect(cookieSet).not.toHaveBeenCalled();
	});

	it('mirrors the yaml default into a browser cookie (no hydration flip)', async () => {
		mockedRead.mockReturnValue({
			text: JSON.stringify({ ui: { locale: 'id' } }),
			missing: false
		} as ReturnType<typeof readSettingsDocument>);
		const cookieSet = vi.fn();
		const event = {
			request: new Request('http://localhost/'),
			url: new URL('http://localhost/'),
			cookies: { set: cookieSet }
		};
		const kitHandle = handle as unknown as (ctx: { event: unknown; resolve: (e: unknown, o: unknown) => Promise<string> }) => Promise<string>;
		await kitHandle({
			event,
			resolve: async () => '<html lang="id">'
		});
		expect(cookieSet).toHaveBeenCalledWith('dsi.locale', 'id', expect.objectContaining({ path: '/' }));
	});

beforeEach(() => {
	mockedRead.mockReset();
	mockedRead.mockReturnValue({ text: '', missing: true } as ReturnType<typeof readSettingsDocument>);
});

describe('hooks SSR locale — one case per state-homes row', () => {
	it('cookie wins (zh) on first paint', async () => {
		expect(await resolveLang({ cookie: 'dsi.locale=zh' })).toBe('<html lang="zh">');
	});

	it('yaml default (id) applies when no cookie', async () => {
		mockedRead.mockReturnValue({
			text: JSON.stringify({ ui: { locale: 'id' } }),
			missing: false
		} as ReturnType<typeof readSettingsDocument>);
		expect(await resolveLang({})).toBe('<html lang="id">');
	});

	it('Accept-Language hint wins when cookie and yaml are silent', async () => {
		expect(await resolveLang({ 'accept-language': 'id-ID,id;q=0.9' })).toBe('<html lang="id">');
	});

	it('en is the last resort', async () => {
		expect(await resolveLang({})).toBe('<html lang="en">');
	});
});

describe('edge cases', () => {
	it('invalid cookie falls through to yaml (zh)', async () => {
		mockedRead.mockReturnValue({
			text: JSON.stringify({ ui: { locale: 'zh' } }),
			missing: false
		} as ReturnType<typeof readSettingsDocument>);
		expect(await resolveLang({ cookie: ' ;; dsi.locale=xx; ' })).toBe('<html lang="zh">');
	});

	it('broken yaml document never 500s — falls through to en', async () => {
		mockedRead.mockReturnValue({ text: 'ui: [broken', missing: false } as ReturnType<
			typeof readSettingsDocument
		>);
		expect(await resolveLang({})).toBe('<html lang="en">');
	});

	it('missing settings file falls through to Accept-Language', async () => {
		expect(await resolveLang({ 'accept-language': 'zh' })).toBe('<html lang="zh">');
	});
});
