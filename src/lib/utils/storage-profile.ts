/**
 * Storage profile — the ONE home of the workspace-profile key convention
 * (extends the 2026-08-24 profile desks from dsi-panels to EVERY dsi-*
 * localStorage key):
 *
 *   no profile   → dsi-panels · dsi-sidebar · dsi-session-filter
 *   ?profile=widi → dsi-panels_widi · dsi-sidebar_widi · dsi-session-filter_widi
 *
 * The profile is sticky (?profile= survives the seed strip, keys the
 * desks) and sanitized here once — every prefs module routes its key
 * through dsiKey so no two call sites re-implement the suffix.
 */

/**
 * Sanitize a raw `?profile=` value into a storage-key-safe segment.
 * Keeps `[A-Za-z0-9_-]` (case preserved — profiles are exact ids), caps at
 * 40 chars; anything that sanitizes to nothing is not a profile.
 * @returns the safe segment, or null when the value carries no usable
 *          characters (the caller then behaves as if no profile were set).
 */
export function sanitizeWorkspaceProfile(raw: string): string | null {
	const safe = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
	return safe.length > 0 ? safe : null;
}

/**
 * The storage key for a workspace profile.
 * @param base the un-suffixed dsi-* key (e.g. 'dsi-panels').
 * @param profile sanitized profile segment, or null/undefined for the
 *                default desk (the base key unchanged).
 */
export function dsiKey(base: string, profile?: string | null): string {
	return profile ? `${base}_${profile}` : base;
}
