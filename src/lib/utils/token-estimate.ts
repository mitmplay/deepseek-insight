/**
 * Client-side token estimation heuristic (OCI port, 2026-08-23).
 *
 * Uses the standard ~4 chars/token approximation.
 * Good enough for a live UI counter — not a replacement for a real tokenizer.
 */

/**
 * Estimate the number of tokens in a text string.
 *
 * @param text - The input text to estimate.
 * @returns Estimated token count (ceil of length/4); 0 for empty/null/undefined.
 */
export function estimateTokens(text: string | null | undefined): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}
