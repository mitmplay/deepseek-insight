/**
 * a2a-protocol tests (2026-08-25) — mint/parse/strip/inject primitives
 * pinned to the ADR contract (2026-08-26 The a2a Signature §3): the
 * signature token is optional, leading, stripped before delivery, and the
 * delivered text always carries exactly one Trial-B protocol line.
 */
import { describe, expect, it } from 'vitest';
import {
	buildDeliveredText,
	injectProtocolLine,
	mintA2aId,
	parseA2aSignature,
	protocolSentence
} from '$lib/services/chat/a2a-protocol';

describe('mintA2aId — a2a- + 16 lowercase hex (crypto random)', () => {
	it('matches the id shape exactly', () => {
		const id = mintA2aId();
		expect(id).toMatch(/^a2a-[0-9a-f]{16}$/);
	});

	it('mints unique ids across a batch', () => {
		const seen = new Set(Array.from({ length: 500 }, () => mintA2aId()));
		expect(seen.size).toBe(500);
	});
});

describe('parseA2aSignature — leading token, hex-id charset, case-tolerant', () => {
	it('parses a valid signature with a message', () => {
		expect(parseA2aSignature('_a2a_:a2a-0123456789abcdef; run the tests')).toEqual({
			id: 'a2a-0123456789abcdef',
			message: 'run the tests'
		});
	});

	it('parses an empty message after the token', () => {
		expect(parseA2aSignature('_a2a_:a2a-0123456789abcdef;')).toEqual({
			id: 'a2a-0123456789abcdef',
			message: ''
		});
	});

	it('is case-tolerant (marker and id normalized to lowercase)', () => {
		expect(parseA2aSignature('_A2A_:A2A-0123456789ABCDEF; hello')).toEqual({
			id: 'a2a-0123456789abcdef',
			message: 'hello'
		});
	});

	it('carries a multiline message verbatim (trimmed ends)', () => {
		expect(parseA2aSignature('_a2a_:a2a-0123456789abcdef; line one\nline two ')).toEqual({
			id: 'a2a-0123456789abcdef',
			message: 'line one\nline two'
		});
	});

	it('rejects a missing trailing semicolon', () => {
		expect(parseA2aSignature('_a2a_:a2a-0123456789abcdef run tests')).toBeNull();
	});

	it('rejects a bare _a2a_ with no id', () => {
		expect(parseA2aSignature('_a2a_ run tests')).toBeNull();
		expect(parseA2aSignature('_a2a_:; run tests')).toBeNull();
	});

	it('rejects an empty id (token with no hex)', () => {
		expect(parseA2aSignature('_a2a_:a2a-; run tests')).toBeNull();
	});

	it('rejects a non-hex id (charset-strict)', () => {
		expect(parseA2aSignature('_a2a_:not-hex-at-all; run tests')).toBeNull();
		expect(parseA2aSignature('_a2a_:a2a-0123xyz; run tests')).toBeNull();
	});

	it('rejects a signature that is not leading (prose echoes are model output, never plumbing)', () => {
		expect(parseA2aSignature('please run _a2a_:a2a-0123456789abcdef; tests')).toBeNull();
	});

	it('rejects non-signature text', () => {
		expect(parseA2aSignature('run the tests')).toBeNull();
		expect(parseA2aSignature('')).toBeNull();
	});
});

describe('injectProtocolLine — the Trial-B wording (ADR §3)', () => {
	it('appends the exact sentence with a joining period', () => {
		expect(injectProtocolLine('run the tests', 'a2a-0123456789abcdef')).toBe(
			'run the tests. Protocol: end your reply with exactly this signature as the final characters: _a2a_:a2a-0123456789abcdef;'
		);
	});

	it('does not double the period when the message ends in punctuation', () => {
		expect(injectProtocolLine('run the tests.', 'a2a-0123456789abcdef')).toBe(
			'run the tests. ' + protocolSentence('a2a-0123456789abcdef')
		);
	});

	it('delivers the protocol line alone for an empty message', () => {
		expect(injectProtocolLine('', 'a2a-0123456789abcdef')).toBe(
			protocolSentence('a2a-0123456789abcdef')
		);
	});
});

describe('buildDeliveredText — strip then inject (the full composer contract)', () => {
	it('round trip: signature present → stripped message + protocol line for that id', () => {
		const delivered = buildDeliveredText('_a2a_:a2a-0123456789abcdef; run the tests', 'a2a-0123456789abcdef');
		expect(delivered).toBe(
			'run the tests. Protocol: end your reply with exactly this signature as the final characters: _a2a_:a2a-0123456789abcdef;'
		);
		expect(delivered.startsWith('_a2a_:')).toBe(false); // plumbing never reaches the target
	});

	it('signature absent → message verbatim + protocol line for the minted id', () => {
		expect(buildDeliveredText('run the tests', 'a2a-fedcba9876543210')).toBe(
			'run the tests. Protocol: end your reply with exactly this signature as the final characters: _a2a_:a2a-fedcba9876543210;'
		);
	});

	it('signature present but a different id is passed → the ledger id wins (minted/normalized)', () => {
		// Task 3.3 always injects the id it will register — parse-then-inject with the row's id
		const delivered = buildDeliveredText('_a2a_:a2a-1111111111111111; run', 'a2a-2222222222222222');
		expect(delivered.endsWith('_a2a_:a2a-2222222222222222;')).toBe(true);
	});
});
