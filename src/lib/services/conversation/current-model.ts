/**
 * current-model — the session's current model id, client-cached
 * (OCI parity wiring, 2026-08-24).
 *
 * The same GET /api/dsh/session/{id}/models the ModelSelector mounts;
 * this tiny module adds a per-session promise cache so a panel can
 * learn the model for context-window resolution without refetching
 * on every mount. Failures resolve undefined (a dead endpoint must
 * never break the footer — the context label simply keeps its
 * no-limit fallback). Browser API only (BC-1/BC-2).
 */

const cache = new Map<string, Promise<string | undefined>>();

/**
 * Fetch (once per session per page load) the session's current model
 * id — `current.model` of the models directory; undefined when the
 * directory is empty, the session is gone, or the call fails.
 */
export function getCurrentModel(sessionId: string): Promise<string | undefined> {
	const cached = cache.get(sessionId);
	if (cached) return cached;
	const p = (async (): Promise<string | undefined> => {
		try {
			const res = await fetch(`/api/dsh/session/${encodeURIComponent(sessionId)}/models`);
			if (!res.ok) return undefined;
			const body = (await res.json().catch(() => null)) as {
				current?: { model?: string } | null;
			} | null;
			return body?.current?.model ?? undefined;
		} catch {
			return undefined;
		}
	})();
	cache.set(sessionId, p);
	return p;
}
