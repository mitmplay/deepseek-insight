/**
 * Auto-open slot selection (ADR-0018 W3 task 3.2) — the pure half of the
 * ConversationPanel's think/plan auto-open state machine (2026-08-31).
 *
 * The component keeps the reactive wrappers ($derived over store + stick,
 * the suppression $state); the SELECTION scans live here so they are
 * unit-testable as plain functions. Wire order is authoritative: scan
 * from the END of the render list, first match wins.
 */

/** Minimal entry shape the scans read (structural — renders entries only). */
interface ScannableEntry {
	id: string;
	kind: string;
	reasoning?: string;
	toolName?: string;
}

/** The newest reasoning entry's id (wire order), else null — the
 * transient think target. Empty reasoning strings do not count (the
 * chip renders nothing to open). */
export function newestReasoningId(entries: readonly ScannableEntry[]): string | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i]!;
		if (e.kind === 'assistant-message' && e.reasoning !== undefined && e.reasoning !== '') {
			return e.id;
		}
	}
	return null;
}

/** The newest todo_write tool-call entry's id (wire order), else null —
 * the STICKY plan target. Stickiness (supersede-only-on-newer) is the
 * caller's effect; this is the detection scan. */
export function newestTodoToolId(entries: readonly ScannableEntry[], isTodoTool: (name: string) => boolean): string | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i]!;
		if (e.kind === 'tool-call' && isTodoTool(e.toolName ?? '')) {
			return e.id;
		}
	}
	return null;
}

/** Suppression-aware view of a raw target: null while the user kept THIS
 * id collapsed (a newer target id simply stops matching). */
export function suppressed(targetId: string | null, suppressedId: string | null): string | null {
	return targetId !== null && suppressedId === targetId ? null : targetId;
}
