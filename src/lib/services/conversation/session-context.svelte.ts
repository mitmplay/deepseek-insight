/**
 * Session Context — Svelte 5 Context API carrying the owning sessionId to
 * transcript descendants that need it for per-session fetches (the
 * FilesEditedCard's changes-summary route, 2026-09-25). The panel-context
 * module is the precedent: set once by ConversationPanel at init, read by
 * any descendant, null (with a safe degraded default) when no provider is
 * present — standalone contexts and unit tests.
 */
import { setContext, getContext } from 'svelte';

const SESSION_KEY = Symbol('dsi-conversation-session');

/** Set the owning session. Called once by ConversationPanel at init. */
export function setConversationSession(sessionId: string): void {
	setContext(SESSION_KEY, sessionId);
}

/** The owning sessionId, or null when no provider is present (standalone
 * mode, tests, non-panel contexts). */
export function getConversationSession(): string | null {
	return getContext<string | null>(SESSION_KEY) ?? null;
}
