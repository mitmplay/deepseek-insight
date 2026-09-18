/**
 * prompt-trigger — pure logic for the "?"-trigger prompt finder
 * (ADR "The Suggest Strip", 2026-08-28; ported from OCI's
 * prompt-suggest-service.ts, `?` branch only).
 *
 * Interaction (strip-only, ADR §6):
 * - Typing a line starting with "?" (e.g. "?load") activates the trigger
 * - The floating strip lists ranked matches with use counts; NO ghost —
 *   the "."-prefix auto-complete and all its textarea-selection machinery
 *   are OCI-only and stay out of DSI by construction
 * - Tab / Enter accepts: the query span is replaced by the prompt's full
 *   text (multiline included), caret at end — the label is only a handle
 *   and never sent (Enter press 1 accepts, press 2 sends — two presses)
 * - Esc dismisses: the strip closes and the query is memoized so the
 *   debounced refetch never resurrects it
 *
 * Prompt Macro (ADR "The Prompt Macro", 2026-08-29): "!" is a second
 * trigger mode — find-and-RUN. Same strip, ranking, debounce; only the
 * accept gesture differs by mode: "?" inserts the row's text, "!" feeds
 * the row's lines to the executor. All "?" semantics are byte-identical.
 *
 * Kept pure (no DOM, no fetch) so it's unit-testable; PromptInput owns
 * the textarea, debounce, and fetch.
 */

// ── Types ──

/** One library row as the client sees it — mirrors the server's
 *  PromptRecord minus created_at (PRD shared-utilities inventory). */
export interface SuggestedPrompt {
	id: number;
	label: string | null;
	text: string;
	use_count: number;
	/** Macro flag (schema v3): 1 = macro prompt, 0 = ordinary. */
	macro: number;
	last_used_at: string;
	/** Space-joined lowercase tag words (schema v4); '' = untagged
	 *  (The Prompt Tags ADR, 2026-09-14, D1). */
	tags: string;
}

/** Minimum query length after "?"/"!" — "?" alone is too noisy (ADR D1 parity). */
export const MIN_QUERY_LEN = 1;

/** Finder trigger characters (Prompt Macro ADR D1): "?" find-and-insert,
 *  "!" find-and-run. Same activation grammar; only accept semantics
 *  differ by mode. */
export const TRIGGER_CHARS = ['?', '!'] as const;

/** The two strip modes a trigger char selects (ADR D1). */
export type TriggerMode = 'find' | 'run';

/** Which mode a trigger query is in — the char after nothing: the FIRST
 *  character of the query string decides ("?load" → find, "!oci" → run).
 *  A non-trigger string answers 'find' (callers gate on getTrigger). */
export function triggerMode(query: string): TriggerMode {
	return query[0] === '!' ? 'run' : 'find';
}

/**
 * Extract the finder trigger from input text + caret position.
 * Active when the text before the caret starts with a trigger char
 * ("?" find, "!" run — identical rules) and carries at least one more
 * character, with no newline in the before-caret slice (the finder is
 * single-line). Spaces are fine — multi-keyword queries are the
 * ";"-and-whitespace AND search.
 * Returns the query including the trigger char, or null when inactive.
 */
export function getTrigger(text: string, caret: number): string | null {
	const before = text.slice(0, caret);
	const lead = before[0];
	if (lead !== '?' && lead !== '!') return null;
	if (before.length < 1 + MIN_QUERY_LEN) return null;
	if (before.includes('\n')) return null; // finder stays single-line
	return before;
}

/** Query-less search key sent to the server ("?load" → "load"; "!oci"
 *  → "oci" — the bang strips exactly like the question mark). */
export function searchKey(query: string): string {
	return query.slice(1);
}

/**
 * Split a search key into keyword terms (AND semantics): split on ";" and
 * whitespace, trim, drop empties, dedupe case-insensitively (first
 * spelling wins). Mirrors the server-side splitQueryTerms in prompts/db.ts
 * — a shared unit test pins the parity (a single source would cross the
 * server/client boundary). `?load;skill;feature-spec` → ["load", "skill",
 * "feature-spec"].
 */
export function splitKey(key: string): string[] {
	const seen = new Set<string>();
	const terms: string[] = [];
	for (const frag of key.split(/[;\s]+/)) {
		const raw = frag.trim();
		if (!raw) continue;
		const lower = raw.toLowerCase();
		if (seen.has(lower)) continue;
		seen.add(lower);
		terms.push(raw);
	}
	return terms;
}

// ── Tag grammar — CLIENT MIRROR (The Prompt Tags ADR, 2026-09-14, D3) ──
// Server truth: $lib/server/prompts/tags.ts. One shared module would cross
// the server/client boundary (the splitKey precedent above); a single unit
// test pins the parity over a shared fixture word list. Keep these
// behavior-identical to the server copies.

/** The tag grammar: 1..32 chars of lowercase letters, digits, dash, underscore. */
export const TAG_PATTERN = /^[a-z0-9_-]{1,32}$/;

/** Is this (already-lowercase) word a legal tag? Callers normalize before asking. */
export function isValidTagWord(word: string): boolean {
	return TAG_PATTERN.test(word);
}

/**
 * Split free-form tag input into normalized tag words: split on any run of
 * whitespace, comma, or semicolon; lowercase; dedupe; drop words that fail
 * the grammar. Empty input returns []. Mirrors parseTagWords server-side.
 */
export function parseTagWords(input: string): string[] {
	const seen = new Set<string>();
	const words: string[] = [];
	for (const frag of input.split(/[\s,;]+/)) {
		const word = frag.trim().toLowerCase();
		if (!word || seen.has(word) || !TAG_PATTERN.test(word)) continue;
		seen.add(word);
		words.push(word);
	}
	return words;
}

/** Space-join normalized words into the stored column form ('git rca'). */
export function joinTagWords(words: string[]): string {
	return parseTagWords(words.join(' ')).join(' ');
}

/**
 * Should this sent text be recorded (use-count upsert)? Plain prompts
 * only — slash commands, @mentions, and "."-, "?"- or "!"-prefixed lines
 * are control traffic and never touch the ledger.
 */
export function shouldRecordPrompt(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	if (
		trimmed.startsWith('/') ||
		trimmed.startsWith('@') ||
		trimmed.startsWith('.') ||
		trimmed.startsWith('?') ||
		trimmed.startsWith('!')
	) {
		return false;
	}
	return true;
}

/**
 * One-line preview for strip rows (ADR D8): first non-empty line of the
 * label-or-text handle. Multiline rows preview their first line and carry
 * the ⏎ badge in the strip instead of spilling newlines into one line.
 */
export function previewOf(row: SuggestedPrompt): string {
	const source = row.label ?? row.text;
	return source.split('\n').find((l) => l.trim().length > 0) ?? '';
}

/**
 * First non-empty line of the row's TEXT only — the label is never
 * consulted. For surfaces that render the label as its own element beside
 * the preview (the manager's label tag + text preview) so the two never
 * duplicate each other.
 */
export function textPreviewOf(row: SuggestedPrompt): string {
	return row.text.split('\n').find((l) => l.trim().length > 0) ?? '';
}

/** Minimum key length before the fuzzy tier runs on the server (F2 floor
 *  — below this, contains/LIKE only; short keys are pure trigram noise).
 *  Client copy for the preview's word-floor parity documentation. */
export const FUZZY_MIN_LEN = 4;

/** One span of a strip preview: plain text, or the matched fragment (F4). */
export interface PreviewSegment {
	text: string;
	hit: boolean;
}

/** Similarity bar a fuzzy word must clear to be highlighted (below = noise). */
const WORD_HL_FLOOR = 0.5;

/**
 * Split a strip preview into plain/highlighted segments (F4).
 *
 * - No query / not a "?" query → single plain previewOf segment.
 * - "?" contains hit (S4) → first line containing ALL terms previews with
 *   EVERY term's span marked, longest-match-first (no overlapping spans);
 *   label first, then text lines, so a match on line 3 previews line 3.
 * - "?" contains miss (S4) → per-term best-matching word highlighted when
 *   it clears 0.5 similarity ("lod" → "load" 0.75); weaker words stay
 *   plain.
 *
 * Matching is case-insensitive (parity with the server LIKE/FTS); segments
 * render the row's original casing.
 */
export function previewSegments(row: SuggestedPrompt, query: string): PreviewSegment[] {
	const plain: PreviewSegment[] = [{ text: previewOf(row), hit: false }];
	if (!query.startsWith('?')) return plain;
	const key = searchKey(query).toLowerCase();
	if (!key) return plain;

	const lines = row.label !== null ? [row.label, ...row.text.split('\n')] : row.text.split('\n');
	const terms = splitKey(key);

	// Tier 1 — contains (S4): first line containing ALL terms previews with
	// every term's span marked, longest-match-first so overlapping candidates
	// never double-mark.
	if (terms.length > 0) {
		for (const line of lines) {
			const spans = markTermSpans(line, terms);
			if (spans) return segmentsFromSpans(line, spans);
		}
	}

	// Tier 2 — fuzzy (S4): best-matching word per term, highlighted when it
	// clears the 0.5 word-similarity floor; weaker words stay plain.
	const perTerm = terms.length > 0 ? terms : key.split(/\s+/).filter(Boolean);
	let bestLine: { line: string; spans: { at: number; len: number }[] } | null = null;
	let bestScore = 0;
	for (const line of lines) {
		let lineScore = 0;
		const spans: { at: number; len: number }[] = [];
		for (const t of perTerm) {
			let best: { at: number; len: number } | null = null;
			let bestTermScore = 0;
			for (const word of line.split(/\s+/)) {
				if (!word) continue;
				const w = word.toLowerCase();
				const score = wordSimilarity(t, w);
				if (score > bestTermScore) {
					bestTermScore = score;
					const at = line.indexOf(word);
					best = { at, len: word.length };
				}
			}
			lineScore += bestTermScore;
			if (best && bestTermScore >= WORD_HL_FLOOR) spans.push(best);
		}
		if (spans.length > 0 && lineScore > bestScore) {
			bestScore = lineScore;
			bestLine = { line, spans: resolveOverlaps(spans) };
		}
	}
	if (bestLine) return segmentsFromSpans(bestLine.line, bestLine.spans);
	return plain;
}

/** Tier-1 span set for one line against every term: null when ANY term is
 *  missing (the line must contain ALL terms to preview — AND semantics);
 *  spans collected for every term, longest-first overlap-resolved. */
function markTermSpans(line: string, terms: string[]): { at: number; len: number }[] | null {
	const l = line.toLowerCase();
	const spans: { at: number; len: number }[] = [];
	for (const t of terms) {
		const at = l.indexOf(t);
		if (at === -1) return null; // AND: one missing term disqualifies the line
		spans.push({ at, len: t.length });
	}
	return resolveOverlaps(spans);
}

/** Overlap resolution (S4): longest-match-first — a longer term's span wins
 *  any overlap, shorter overlapping spans are dropped entirely (never
 *  nested-rendered). Non-overlapping spans pass through unchanged. */
function resolveOverlaps(spans: { at: number; len: number }[]): { at: number; len: number }[] {
	const sorted = [...spans].sort((a, b) =>
		(b.at + b.len) - (a.at + a.len) || b.len - a.len || a.at - b.at
	);
	const kept: { at: number; len: number }[] = [];
	for (const span of sorted) {
		if (kept.some((k) => span.at < k.at + k.len && k.at < span.at + span.len)) continue;
		kept.push(span);
	}
	return kept.sort((a, b) => a.at - b.at);
}

/** Render a line as plain/hit segments over the given hit spans. Full-width
 *  rows: the whole line renders — no sliding window, no ellipses; CSS
 *  ellipsis on the label guards only the extreme case. */
function segmentsFromSpans(line: string, spans: { at: number; len: number }[]): PreviewSegment[] {
	const segments: PreviewSegment[] = [];
	let cursor = 0;
	for (const sp of spans) {
		if (sp.at > cursor) segments.push({ text: line.slice(cursor, sp.at), hit: false });
		segments.push({ text: line.slice(sp.at, sp.at + sp.len), hit: true });
		cursor = sp.at + sp.len;
	}
	if (cursor < line.length) segments.push({ text: line.slice(cursor), hit: false });
	return segments;
}

/**
 * Trigram-bag Dice coefficient (Sørensen): 2·|A ∩ B| / (|A| + |B|) over
 * multiset trigram counts. Returns 0 when either side has no trigrams
 * (length < 3). Parity copy of the server's fuzzy math (prompts/db.ts) —
 * the boundary keeps the two implementations separate; unit vectors pin
 * them together.
 */
export function diceSimilarity(a: string, b: string): number {
	const grams = new Map<string, number>();
	for (let i = 0; i + 3 <= a.length; i++) {
		const g = a.slice(i, i + 3);
		grams.set(g, (grams.get(g) ?? 0) + 1);
	}
	if (grams.size === 0) return 0;
	let bCount = 0;
	let shared = 0;
	for (let i = 0; i + 3 <= b.length; i++) {
		bCount++;
		const g = b.slice(i, i + 3);
		const have = grams.get(g) ?? 0;
		if (have > 0) {
			shared++;
			if (have === 1) grams.delete(g);
			else grams.set(g, have - 1);
		}
	}
	if (bCount === 0) return 0;
	const aCount = a.length - 2;
	return (2 * shared) / (aCount + bCount);
}

/**
 * Word-level similarity: max of Dice and normalized edit distance — Dice is
 * meaningless for words shorter than 3 trigrams/chars, edit covers them
 * ("lod" vs "load": Dice 0, edit 0.75 → 0.75).
 */
export function wordSimilarity(a: string, b: string): number {
	const edit = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
	return Math.max(diceSimilarity(a, b), edit);
}

/** Wagner–Fischer edit distance (two-row DP), case handled by callers. */
function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(
				prev[j] + 1,
				cur[j - 1] + 1,
				prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
		}
		prev = cur;
	}
	return prev[b.length];
}
