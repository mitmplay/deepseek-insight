/**
 * truncate — single truncation implementation for display strings (Wave 2,
 * task 2.1; PRD §3.3 shared layer).
 *
 * Server-safe: pure string math, no DOM, no length-vs-bytes surprises beyond
 * UTF-16 code units (same units String.prototype.slice uses). Everything that
 * caps display text uses this — `callSummary()`'s former inline 120-char cap
 * is promoted onto it (task 2.1); the ToolCallChip result pane switches to it
 * when tool payloads move server-side in Wave 3.
 *
 * BC-11 note: truncation is a DISPLAY operation; it never mutates wire data
 * (argsRaw/resultText on entries stay full — pinned by dsh-events tests).
 */

export interface TruncateResult {
	/** The text to render (already cut, marker-less). */
	head: string;
	/** True when cutting happened — callers append their own affordance. */
	truncated: boolean;
	/** Characters cut (head.length + cutChars === input.length). */
	cutChars: number;
}

/**
 * Cut `text` to at most `max` characters. `max` <= 0 returns the full text
 * (max means "no limit" — documented contract, pinned by tests).
 */
export function truncate(text: string, max: number): TruncateResult {
	if (max <= 0 || text.length <= max) return { head: text, truncated: false, cutChars: 0 };
	return { head: text.slice(0, max), truncated: true, cutChars: text.length - max };
}
