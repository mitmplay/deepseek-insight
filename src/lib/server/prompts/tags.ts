/**
 * Tag grammar — SERVER TRUTH (The Prompt Tags ADR, 2026-09-14, D3).
 *
 * A tag is a WORD, not a field: 1..32 chars of [a-z0-9_-], stored lowercase
 * and space-joined in one TEXT column. Input splits on any run of
 * whitespace, comma, or semicolon; words are lowercased, deduped
 * (first spelling wins — moot after lowercase, kept for parse-order
 * stability), and invalid words are DROPPED at parse time. The wire gate
 * that must reject (not drop) lives with the route; this module is pure.
 *
 * The client mirror lives in services/chat/prompt-trigger.ts — one shared
 * module would cross the server/client boundary (the splitKey precedent);
 * a single unit test pins the parity over a shared fixture word list.
 * Keep the two implementations byte-equivalent in behavior.
 */

/** The tag grammar: 1..32 chars of lowercase letters, digits, dash, underscore. */
export const TAG_PATTERN = /^[a-z0-9_-]{1,32}$/;

/** Is this (already-lowercase) word a legal tag? Uppercase is illegal
 *  here — callers normalize BEFORE asking; normalizeTags never produces
 *  a word this rejects for case. */
export function isValidTagWord(word: string): boolean {
	return TAG_PATTERN.test(word);
}

/**
 * Split free-form tag input into normalized tag words: split on any run
 * of whitespace, comma, or semicolon; lowercase; dedupe; drop words that
 * fail the grammar. Empty/null-ish input returns []. Mirrors the client
 * parseTags in prompt-trigger.ts (parity test pins it).
 *
 * @param input raw tag text, e.g. 'Git, rca;;  kb x!'
 * @returns normalized valid words, e.g. ['git', 'rca', 'kb'] — 'x!' dropped
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
