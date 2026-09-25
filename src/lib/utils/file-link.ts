/**
 * file-link — pure predicates for transcript file links (File Link Intent
 * spec, 2026-09-25; ADR The File Link Intent D2/D4). No DOM, no I/O: the
 * sanitizer (markdown.ts) stays pure and the transcript handler stays
 * testable — this module is the shared layer both import.
 *
 * The CONFINEMENT authority is the host (workspace-tree/workspace-file
 * routes refuse outside-workspace reads); these predicates are a client
 * fast-fail, not a security boundary.
 */

/** True when the segment escapes the workspace — never a real file. */
function hasDotDotSegment(path: string): boolean {
	return path.split('/').some((segment) => segment === '..');
}

/**
 * Should this href be treated as a workspace file link? Scheme-free
 * relative paths only: http(s) is the external branch, anything carrying
 * a scheme (javascript:, data:, mailto:) or a protocol-relative // is
 * refused (BC-12 layering), /api/ is DSI's own capability surface and
 * must never be re-interpreted as a workspace file.
 */
export function isFileLinkHref(href: string): boolean {
	const value = href.trim();
	if (value === '') return false;
	if (/^https?:\/\//i.test(value)) return false;
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false;
	if (value.startsWith('//')) return false;
	if (value.startsWith('/api/')) return false;
	return true;
}

/**
 * Normalize a file-link href to a workspace-relative path: strip a
 * leading './', collapse duplicate slashes, strip a single leading slash.
 * Returns null when the path escapes the workspace ('..' anywhere) or
 * normalizes to empty.
 */
export function normalizeFileLinkPath(href: string): string | null {
	let value = href.trim().replace(/^\.\//, '').replace(/\/{2,}/g, '/');
	if (value.startsWith('/')) value = value.slice(1);
	if (value === '' || hasDotDotSegment(value)) return null;
	return value;
}

/**
 * The existence gate (ADR D3): probe the dirname via the confined tree
 * route and require the basename in the listing. Any refusal (404
 * missing/outside, 415, 502, transport) resolves false — the click
 * drops. Uses the injected fetch so tests mount the double.
 */
export async function workspaceFileExists(
	sessionId: string,
	path: string,
	fetchImpl: typeof fetch = fetch
): Promise<boolean> {
	const clean = path.split('#')[0];
	if (clean === '') return false;
	const slash = clean.lastIndexOf('/');
	const dir = slash === -1 ? '' : clean.slice(0, slash);
	const base = slash === -1 ? clean : clean.slice(slash + 1);
	try {
		const res = await fetchImpl(
			`/api/dsh/workspace-tree?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(dir)}`
		);
		if (!res.ok) return false;
		const body = (await res.json()) as {
			ok?: boolean;
			listing?: { entries?: { name: string; type: string }[] };
		};
		if (body?.ok !== true || !Array.isArray(body.listing?.entries)) return false;
		return body.listing.entries.some((entry) => entry.name === base);
	} catch {
		return false;
	}
}
