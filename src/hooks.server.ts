/**
 * SSR locale middleware — Three Tongues W1 task 1.4 (ADR 2026-09-12 D2/D3).
 *
 * paraglideMiddleware resolves the request locale with the compiled
 * strategy order (cookie → preferredLanguage → baseLocale). The ADR's
 * operator default (ui.locale in settings.yaml) slots BETWEEN cookie and
 * header: when the request carries no dsi.locale cookie, we inject the
 * yaml default as a cookie on the request before the middleware runs —
 * so paraglide's cookie strategy reads it and the order becomes exactly
 * cookie → yaml → Accept-Language → en.
 *
 * The resolved locale lands in the page via the %paraglide.locale%
 * placeholder in src/app.html (first paint, no flash).
 *
 * The root layout's config-fetch contract (+layout.ts) is untouched:
 * this handle hook composes BEFORE Kit's own plumbing and changes no
 * fetch behavior.
 */

import { paraglideMiddleware } from '$lib/paraglide/server';
import { readOperatorYamlLocale } from '$lib/server/locale';
import { resolveUiLocale, UI_LOCALES } from '$lib/config';

/** The request's dsi.locale cookie value, if it names a fleet locale. */
function validCookieLocale(request: Request): string | undefined {
	const raw = request.headers
		.get('cookie')
		?.split(';')
		.map((c) => c.trim())
		.find((c) => c.startsWith('dsi.locale='))
		?.slice('dsi.locale='.length);
	return raw !== undefined && UI_LOCALES.includes(raw as never) ? raw : undefined;
}

import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const yamlLocale = readOperatorYamlLocale();
	let request = event.request;
	// Inject the yaml default ONLY when no valid cookie spoke: an invalid or
	// stale cookie value must fall through to the lower homes, not block them
	// (ADR D3 — an invalid layer is silence; probe-fixed 2026-09-12).
	if (yamlLocale !== undefined && validCookieLocale(request) === undefined) {
		const headers = new Headers(request.headers);
		// Strip stale dsi.locale entries first — paraglide reads the FIRST
		// match, so an invalid entry ahead of the injected one would win.
		const kept = (headers.get('cookie') ?? '')
			.split(';')
			.map((c) => c.trim())
			.filter((c) => c.length > 0 && !c.startsWith('dsi.locale='));
		kept.push('dsi.locale=' + encodeURIComponent(String(yamlLocale)));
		headers.set('cookie', kept.join('; '));
		// Mirror the yaml default into a real cookie so the CLIENT runtime
		// (which re-resolves from document.cookie and cannot see yaml) paints
		// the same language — no hydration flip. The device keeps the choice;
		// the operator's yaml stays the durable default for new devices.
		event.cookies.set('dsi.locale', String(yamlLocale), {
			path: '/',
			// the client runtime reads document.cookie — HttpOnly would hide it;
			// secure only when the origin is https (DSI runs on http localhost)
			httpOnly: false,
			secure: event.url.protocol === 'https:'
		});
		request = new Request(request.url, {
			method: request.method,
			headers,
			body: request.body,
			duplex: 'half'
		} as RequestInit);
		event.request = request;
	}
	return paraglideMiddleware(request, ({ request: localizedRequest, locale }) => {
		event.request = localizedRequest;
		return resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%paraglide.locale%', locale)
		});
	});
};
