/**
 * Composer draft persistence — the per-session prompt draft survives HMR
 * strikes and full reloads (2026-08-30): PromptInput saves here debounced
 * while the operator types, restores at mount with the caret at the end,
 * and clears the moment the draft empties (send, macro run-accept) so a
 * sent prompt never resurrects.
 *
 * Key shape: one entry per session — `dsi-draft_<sessionId>` — with no
 * workspace-profile suffix: the draft belongs to the session, and the
 * same session is reachable from every desk. The payload records whether
 * the textarea owned the caret at save time (`focused`), so a restore
 * re-focuses only the composer the operator was actually typing in.
 *
 * Pure localStorage round-trip (sidebar-prefs pattern): SSR-safe (no
 * localStorage → nothing stored, nothing restored), junk payloads fall
 * back to nothing, and writes are best-effort — a full or blocked store
 * only loses persistence, never the composer.
 */

/** localStorage key prefix; the session id completes the key. */
const DRAFT_KEY_PREFIX = 'dsi-draft_';

/** Drafts beyond this count (oldest first) are pruned on save. */
const MAX_STORED_DRAFTS = 20;

/** A stored draft snapshot (the localStorage payload). */
interface DraftSnapshot {
	/** Draft text verbatim (never trimmed — the operator's whitespace). */
	text: string;
	/** The textarea owned the caret when the snapshot was taken. */
	focused: boolean;
	/** Save wall-clock ms — prune ordering only. */
	ts: number;
}

/** The draft a mount restores (ts is internal bookkeeping, not exposed). */
export interface LoadedDraft {
	/** Draft text verbatim. */
	text: string;
	/** The snapshot was taken while the operator was typing. */
	focused: boolean;
}

/**
 * Read the stored draft for a session.
 * @param sessionId the panel's session id (the key tail).
 * @returns the draft when present and well-formed, null when absent,
 *          junk, empty, or SSR (no localStorage).
 */
export function loadDraft(sessionId: string): LoadedDraft | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(DRAFT_KEY_PREFIX + sessionId);
		if (raw === null) return null;
		const parsed = JSON.parse(raw) as Partial<DraftSnapshot> | null;
		if (parsed === null || typeof parsed !== 'object') return null;
		if (typeof parsed.text !== 'string' || parsed.text.length === 0) return null;
		return { text: parsed.text, focused: parsed.focused === true };
	} catch {
		return null; // junk JSON — nothing to restore
	}
}

/**
 * Write the draft snapshot for a session (best-effort). An empty text
 * clears the entry instead of storing it.
 * @param sessionId the panel's session id (the key tail).
 * @param text draft text verbatim.
 * @param focused whether the textarea owned the caret at snapshot time.
 */
export function saveDraft(sessionId: string, text: string, focused: boolean): void {
	if (typeof localStorage === 'undefined') return;
	try {
		if (text.length === 0) {
			localStorage.removeItem(DRAFT_KEY_PREFIX + sessionId);
			return;
		}
		const snapshot: DraftSnapshot = { text, focused, ts: Date.now() };
		localStorage.setItem(DRAFT_KEY_PREFIX + sessionId, JSON.stringify(snapshot));
		pruneDrafts(sessionId);
	} catch {
		// Store full or blocked — persistence is lost, the composer is not.
	}
}

/**
 * Remove the stored draft for a session (the draft emptied — sent, macro
 * run — and must never resurrect).
 * @param sessionId the panel's session id (the key tail).
 */
export function clearDraft(sessionId: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(DRAFT_KEY_PREFIX + sessionId);
	} catch {
		// Store blocked — a stale entry may survive; the next empty save
		// retries the removal.
	}
}

/**
 * Drop the oldest drafts beyond MAX_STORED_DRAFTS (the just-written
 * session excepted) so abandoned sessions cannot grow the store without
 * bound. Junk entries sort oldest — pruned first.
 */
function pruneDrafts(keepSessionId: string): void {
	const entries: { key: string; ts: number }[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key === null || !key.startsWith(DRAFT_KEY_PREFIX)) continue;
		if (key === DRAFT_KEY_PREFIX + keepSessionId) continue;
		let ts = 0;
		try {
			const raw = localStorage.getItem(key);
			const parsed = raw === null ? null : (JSON.parse(raw) as Partial<DraftSnapshot> | null);
			if (parsed !== null && typeof parsed.ts === 'number' && Number.isFinite(parsed.ts)) {
				ts = parsed.ts;
			}
		} catch {
			// junk entry — ts stays 0, pruned first
		}
		entries.push({ key, ts });
	}
	entries.sort((a, b) => b.ts - a.ts); // newest first
	for (const entry of entries.slice(MAX_STORED_DRAFTS - 1)) {
		localStorage.removeItem(entry.key);
	}
}
