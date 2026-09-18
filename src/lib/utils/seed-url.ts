/**
 * Seed deep-link builder — the ONE place that shapes a conversation URL
 * (ADR-0006 R1 + the profile convention, 2026-08-24; address moved to the
 * app root by the Root-is-the-Floor ADR, 2026-09-02).
 *
 * Shape: `/?sessionKey=<id>` and, when a workspace profile is active,
 * `&profile=<id>`. The sessionKey is a ONE-SHOT seed (stripped after
 * load); the profile is STICKY (retained in the URL after the strip) and
 * selects which localStorage desk the workspace persists under
 * (`dsi-panels` vs `dsi-panels_<profile>`).
 *
 * `encodeURIComponent` (not URLSearchParams) so spaces encode as `%20`,
 * matching every existing href assertion.
 */

/**
 * Build the seed deep link for a session.
 * @param sessionId the DSH session id to seed.
 * @param profile sanitized workspace profile, or null for the default desk.
 */
export function conversationSeedUrl(sessionId: string, profile: string | null = null): string {
	const base = `/?sessionKey=${encodeURIComponent(sessionId)}`;
	return profile !== null ? `${base}&profile=${encodeURIComponent(profile)}` : base;
}
