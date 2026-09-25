/**
 * Global fetch double for happy-dom unit tests (RCA 2026-09-24, terminal
 * ECONNREFUSED storm): happy-dom's default base URL is http://localhost:3000,
 * so any unstubbed relative fetch() from a mounted component rides into a
 * REAL connect — undici tries ::1 and 127.0.0.1 and Node prints one
 * AggregateError per attempt, ~75 per `pnpm test` run. Tests still passed
 * because components .catch() the rejection; the noise was pure stderr.
 *
 * This setup answers every same-origin /api/ URL with a 404 { ok:false } —
 * deliberately the SAME observable outcome the ECONNREFUSED catch arms
 * produced (sessionPath stays null, buttons stay hidden), so no existing
 * assertion changes. Tests that assert specific fetch bodies keep their
 * own installDefaultFetch()/vi.stubGlobal — per-test stubs installed later
 * simply replace this one.
 *
 * Node-environment files (environmentMatchGlobs — server-only seams) are
 * left untouched: no window, no relative fetches.
 */
if (typeof window !== 'undefined') {
	// Canvas 2D double for @git-diff-view/svelte's text measurement: the
	// vendor's useTextWidth effect calls ctx.font = … on a getContext('2d')
	// result that is null in happy-dom — the thrown TypeError killed the
	// mounting effect graph (observed 2026-09-25: consecutive-hover test
	// froze the whole card). A stub context keeps the vendor effect a no-op.
	const proto = (window as unknown as { HTMLCanvasElement?: { prototype: Record<string, unknown> } }).HTMLCanvasElement?.prototype;
	if (proto && typeof proto.getContext === 'function') {
		proto.getContext = (() => ({ font: '', measureText: () => ({ width: 10 }) })) as unknown as typeof proto.getContext;
	}
	const realFetch = globalThis.fetch.bind(globalThis);
	const origin = window.location.origin;

	// eslint-disable-next-line -- vitest setup: installed once per worker.
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url =
			typeof input === 'string' || input instanceof URL
				? String(input)
				: input.url;
		// Same-origin (or relative, which resolves here) → safe synthetic 404.
		if (!/^https?:/i.test(url) || url.startsWith(origin)) {
			return new Response(JSON.stringify({ ok: false, error: 'fetch-double: no test stub for ' + url }), {
				status: 404,
				headers: { 'content-type': 'application/json' }
			});
		}
		// External absolute URLs (CDN samples, etc.) still hit the real network.
		return realFetch(input, init);
	}) as typeof fetch;
}
