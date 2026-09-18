/**
 * a2a-protocol (2026-08-25) — the delegation signature primitives for the
 * agent-to-agent mention: mint, parse, strip, and the one protocol line
 * that turns correlation from hope into contract.
 *
 * ADR: dev/architectural-decission/2026-08-26 - The a2a Signature —
 *      Correlation IDs and the Delegation Ledger.md §3 (Trial-B wording).
 * Spec: dev/specs/2026-08-25 - DSI a2a Signature and Delegation Ledger
 *      (PRD module map "a2a-protocol"; Tasks 1.1/1.2).
 *
 * Browser-safe by design: no I/O, no server imports — the composer parses
 * the token client-side; only the primitives live here (BC-2 clean).
 */

/** A parsed signature token + its stripped message. */
export interface A2aSignature {
	/** The correlation id — canonical lowercase (`a2a-` + hex). */
	id: string;
	/** The message with the signature token removed, trimmed. */
	message: string;
}

/** Minted id shape: `a2a-` + 16 lowercase hex chars (crypto random). */
const MINT_HEX_CHARS = 16;

/**
 * Accepted id charset when parsing: `a2a-` + hex (1–64 chars), case-tolerant
 * — the minted length is 16, parsing stays charset-strict but length-tolerant
 * (ADR §3 allows "a2a- + random hex"; we normalize to lowercase on parse).
 */
const A2A_ID_SOURCE = 'a2a-[0-9a-f]{1,64}';

/** The leading signature token: `***;` + the message after it. */
const SIGNATURE_RE = new RegExp(`^_a2a_:(${A2A_ID_SOURCE});\\s*([\\s\\S]*)$`, 'i');

/** Mint a fresh correlation id: `a2a-` + 16 hex from crypto random. */
export function mintA2aId(): string {
	const bytes = new Uint8Array(MINT_HEX_CHARS / 2);
	crypto.getRandomValues(bytes);
	return `a2a-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Parse a leading `_a2a_:<id>;` token off a composer message.
 * Returns null when the token is absent, malformed (missing `;`, empty id,
 * non-hex id), or not leading — a signature mid-prose is never plumbing
 * (ADR §4 Trial A: prose echoes are the model's output, not the sender's).
 * Case-tolerant on marker and id; the id is normalized to lowercase.
 */
export function parseA2aSignature(text: string): A2aSignature | null {
	const m = SIGNATURE_RE.exec(text.trim());
	if (m === null) return null;
	return { id: m[1].toLowerCase(), message: m[2].trim() };
}

/** The Trial-B instruction sentence (ADR §3 — mandatory injection). */
export function protocolSentence(id: string): string {
	return `Protocol: end your reply with exactly this signature as the final characters: _a2a_:${id};`;
}

/**
 * Append the Trial-B protocol line to a message (ADR §3: the delivered
 * message carries exactly one instruction line). A terminal period joins
 * unless the message already ends in punctuation; an empty message
 * delivers the protocol line alone.
 */
export function injectProtocolLine(message: string, id: string): string {
	const m = message.trim();
	if (m === '') return protocolSentence(id);
	const joiner = /[.!?]$/.test(m) ? ' ' : '. ';
	return `${m}${joiner}${protocolSentence(id)}`;
}

/**
 * Build the text actually delivered to the target session (Task 3.3's POST
 * body): strip any leading signature token, then inject the protocol line
 * for the id the ledger will track (minted or user-supplied).
 */
export function buildDeliveredText(message: string, id: string): string {
	const stripped = parseA2aSignature(message)?.message ?? message.trim();
	return injectProtocolLine(stripped, id);
}
