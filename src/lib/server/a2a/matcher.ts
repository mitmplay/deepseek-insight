/**
 * a2a-matcher (2026-08-25) — the PURE tier classifier: does this reply
 * text carry the delegation's signature, and how certainly?
 *
 * ADR: dev/architectural-decission/2026-08-26 - The a2a Signature —
 *      Correlation IDs and the Delegation Ledger.md §4 (tier contract,
 *      binding) + The Mention Watcher ADR (detection half).
 * Spec: dev/specs/2026-08-25 - DSI a2a Signature and Delegation Ledger
 *      (PRD "Tier contract"; Tasks 2.2/2.2-T).
 *
 * PURE by contract: imports NOTHING, touches NOTHING — no I/O, no
 * config, no db. The watcher (W3) maps tiers to ledger states
 * (exact→replied_exact, attributed→replied, none→replied_approx);
 * timeout/gone are watcher-native, never matcher outputs.
 */

/** Match outcome tiers — every state names its certainty. */
export type A2aMatchTier = 'exact' | 'attributed' | 'none';

/**
 * Classify a completed reply text against a delegation signature id.
 *
 * Tier 1 'exact'   — the trimmed reply ENDS WITH `_a2a_:<id>;` (the
 *                    instructed echo). "Trimmed" tolerates trailing
 *                    whitespace AND trailing code fences (Task 2.2-T:
 *                    "whitespace/code-fence around suffix → exact after
 *                    trim" — LLMs close their fences after echoing).
 * Tier 2 'attributed' — `_a2a_:<id>` appears anywhere in the text
 *                    (echoed but not terminal — partial compliance).
 * Tier 3 'none'    — the signature is absent: watermark-crossed only;
 *                    the watcher records replied_approx (certainty-
 *                    named; never a confident claim).
 *
 * Case-tolerant on the `_a2a_` marker and the id (the composer may be
 * typed in any case; ids are lowercase-canonical at mint/parse).
 */
export function classifyReply(replyText: string, id: string): A2aMatchTier {
	const text = replyText.toLowerCase();
	const needle = `_a2a_:${id.toLowerCase()}`;
	// Terminal tail = text after trimming whitespace and closing code
	// fences (a fenced echo still ends the reply's content).
	let tail = text.trimEnd();
	for (let i = 0; i < 3 && tail.endsWith('```'); i++) {
		tail = tail.slice(0, -3).trimEnd();
	}
	if (tail.endsWith(needle + ';')) return 'exact';
	if (text.includes(needle)) return 'attributed';
	return 'none';
}
