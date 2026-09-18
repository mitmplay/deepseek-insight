/**
 * slash-directory — module-scope reactive cache for the composer's `/`
 * menu (Slash Menu ADR §3.2, task 1.3): ONE catalog read per session,
 * fetched on FIRST MENU OPEN and never on panel mount (ADR §3.3 — a
 * panel must not wake a cold session; commands/list may resume one).
 *
 * Per-session entries hold {commands, skills, state}:
 *   idle → loading → ready
 *                 ↘ failed (un-cached — the next read retries; a stale
 *                            failure must never pose as a catalog)
 *
 * Single-flight: concurrent directoryFor(sessionId) calls share ONE
 * fetch; the promise is dropped on settle (the next cold read starts a
 * fresh one). Invalidations (event-callback registry — the
 * Communication Map's only server→cache channel):
 *   commands/change       → invalidateAll()  (any session's vocabulary moved)
 *   agent-preset/selected → invalidate(that session)
 *   mux socket reset      → invalidateAll()  (host generation changed)
 *
 * No polling, no timers (the strip's rule); a failed fetch degrades to
 * the menu's error row — the draft, the strip, and the passthrough keep
 * working (strip degrade rule, PRD §4).
 *
 * BC-2: client service — no $lib/server imports; the catalog rides the
 * /api/dsh/session/<id>/catalog route. No hardcoded vocabulary lives
 * here (ADR §4.2): rows come from the wire verbatim, host order kept.
 */

import type { DsiCommandRow, DsiSkillRow } from '$lib/types';

/** One session's cached catalog + its lifecycle state. */
export interface SlashDirectory {
	/** Host command rows, wire order (name-sorted by the host). */
	commands: DsiCommandRow[];
	/** Host skill rows, wire order. */
	skills: DsiSkillRow[];
	/** idle (never read) · loading (fetch in flight) · ready · failed. */
	state: 'idle' | 'loading' | 'ready' | 'failed';
}

interface DirectoryEntry extends SlashDirectory {
	/** Single-flight promise — present only while loading. */
	inflight?: Promise<void>;
}

/** Session-keyed cache (module scope — one per browser tab, like the runner). */
const entries = new Map<string, DirectoryEntry>();

/** One fresh reactive entry (idle; never fetched). Entries are $state
 *  proxies (W2 2.3): the panel holds the object directoryFor returned
 *  and its template re-renders when a flight settles (loading → ready)
 *  or invalidation swaps rows — a plain object would never notify. The
 *  variable-initializer placement is the legal one inside a .svelte.ts
 *  module function (a `return $state(...)` expression form is not). */
function newEntry(): DirectoryEntry {
	const entry = $state<DirectoryEntry>({
		commands: [],
		skills: [],
		state: 'idle',
		inflight: undefined
	});
	return entry;
}

/** Invalidation registry — dsh-connection subscribes at boot (task 1.3 wiring). */
type InvalidationListener = (sessionId: string | 'all') => void;
const listeners = new Set<InvalidationListener>();

/** Subscribe to invalidation events (connection arms fire these). */
export function onCatalogInvalidated(fn: InvalidationListener): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function fireInvalidated(scope: string | 'all'): void {
	for (const fn of listeners) fn(scope);
}

/** Fetch one session's catalog through the route (never $lib/server — BC-2). */
async function fetchCatalog(sessionId: string, entry: DirectoryEntry): Promise<void> {
	entry.state = 'loading';
	try {
		const res = await fetch(`/api/dsh/session/${encodeURIComponent(sessionId)}/catalog`);
		const body = (await res.json().catch(() => null)) as
			| { ok?: boolean; commands?: DsiCommandRow[]; skills?: DsiSkillRow[]; error?: { message?: string } }
			| null;
		if (!res.ok || body?.ok !== true || !Array.isArray(body.commands) || !Array.isArray(body.skills)) {
			throw new Error(body?.error?.message ?? `catalog fetch failed (HTTP ${res.status})`);
		}
		entry.commands = body.commands;
		entry.skills = body.skills;
		entry.state = 'ready';
	} catch {
		// Failed fetch un-caches (next read retries); the menu shows its
		// error row this render via the returned failed view.
		entry.state = 'failed';
		entries.delete(sessionId);
	} finally {
		entry.inflight = undefined;
	}
}

/** A failed entry still rendered once (state 'failed', empty rows). */
function failedDirectory(): SlashDirectory {
	return { commands: [], skills: [], state: 'failed' };
}

/**
 * The menu's read: reactive {commands, skills, state} for one session.
 * First call per session (post-invalidation) starts the fetch; the
 * object is a stable per-session view — callers may keep it and their
 * $derived reads re-run on state changes.
 */
export function directoryFor(sessionId: string): SlashDirectory {
	let entry = entries.get(sessionId);
	if (entry === undefined) {
		entry = newEntry();
		entries.set(sessionId, entry);
	}
	if (entry.state === 'idle' && entry.inflight === undefined) {
		entry.inflight = fetchCatalog(sessionId, entry);
	}
	// failed entries were un-cached: a caller still holding this call's
	// return sees the failed view once (the next directoryFor re-fetches).
	return entry.state === 'failed' ? failedDirectory() : entry;
}

/**
 * Drop one session's cache (agent-preset/selected arm). No-op on an
 * absent key (cache contract — the frame may name a session DSI never
 * cached). The NEXT read refetches; nothing is fetched here.
 */
export function invalidate(sessionId: string): void {
	entries.delete(sessionId);
	fireInvalidated(sessionId);
}

/** Drop every session's cache (commands/change arm, socket reset). */
export function invalidateAll(): void {
	entries.clear();
	fireInvalidated('all');
}
