/**
 * Prompt tag grammar unit tests (The Prompt Tags ADR, 2026-09-14, D3).
 *
 * Server truth ($lib/server/prompts/tags.ts) and client mirror
 * (services/chat/prompt-trigger.ts) are pinned behavior-identical over a
 * shared fixture word list — the splitKey parity idiom: one shared module
 * would cross the server/client boundary, so the test is the parity pin.
 */

import { describe, expect, it } from 'vitest';

import { joinTagWords, isValidTagWord, parseTagWords, TAG_PATTERN } from '$lib/server/prompts/tags.js';
import {
	joinTagWords as clientJoinTagWords,
	isValidTagWord as clientIsValidTagWord,
	parseTagWords as clientParseTagWords,
	TAG_PATTERN as CLIENT_TAG_PATTERN
} from '$lib/services/chat/prompt-trigger';

/** Fixture word list both implementations must agree on (grammar edges). */
const FIXTURE_WORDS = [
	'git',
	'rca',
	'session',
	'a',
	'_',
	'-',
	'kb-writer',
	'code_review',
	'0',
	'x'.repeat(32)
];

describe('tag grammar — accepts (server truth)', () => {
	it('accepts a-z, 0-9, dash, underscore, 1..32 chars', () => {
		for (const w of FIXTURE_WORDS) expect(isValidTagWord(w)).toBe(true);
	});

	it('rejects everything else: uppercase, spaces, punctuation, +, %, empty, 33 chars', () => {
		for (const w of ['Git', 'RCA', 'a b', 'a!b', '+word', '%wild', 'tag:w', '', '-'.repeat(33)]) {
			expect(isValidTagWord(w)).toBe(false);
		}
		expect(TAG_PATTERN.test('')).toBe(false);
	});
});

describe('parseTagWords — split/lowercase/dedupe/drop (server truth)', () => {
	it('splits on whitespace, commas, and semicolons', () => {
		expect(parseTagWords('git, rca;;  kb')).toEqual(['git', 'rca', 'kb']);
		expect(parseTagWords('git\trca\nkb')).toEqual(['git', 'rca', 'kb']);
	});

	it('lowercases input words', () => {
		expect(parseTagWords('Git RCA')).toEqual(['git', 'rca']);
	});

	it('dedupes after lowercasing (first occurrence keeps position)', () => {
		expect(parseTagWords('git Git GIT rca')).toEqual(['git', 'rca']);
	});

	it('drops invalid words instead of throwing', () => {
		expect(parseTagWords('git +rca! ok')).toEqual(['git', 'ok']);
	});

	it('empty input returns an empty array', () => {
		expect(parseTagWords('')).toEqual([]);
		expect(parseTagWords('  ,,;; ')).toEqual([]);
	});

	it('joinTagWords round-trips to the stored space-joined form', () => {
		expect(joinTagWords(['git', 'rca'])).toBe('git rca');
		expect(joinTagWords(['Git', '+rca!', 'git'])).toBe('git'); // '+rca!' dropped, 'git' deduped
	});
});

describe('client mirror parity — prompt-trigger vs server truth (D3 pin)', () => {
	it('the grammar regexes are identical', () => {
		expect(CLIENT_TAG_PATTERN.source).toBe(TAG_PATTERN.source);
		expect(CLIENT_TAG_PATTERN.flags).toBe(TAG_PATTERN.flags);
	});

	it('isValidTagWord agrees over the fixture list and the reject list', () => {
		const rejects = ['Git', 'a b', '+word', '', 'x'.repeat(33), 'ta%g'];
		for (const w of [...FIXTURE_WORDS, ...rejects]) {
			expect(clientIsValidTagWord(w)).toBe(isValidTagWord(w));
		}
	});

	it('parseTagWords agrees over a shared fixture input list', () => {
		const inputs = [
			'git, rca;;  kb',
			'Git Git GIT rca',
			'git +rca! ok',
			'',
			'  ,,;; ',
			'a-b_c9 x!'
		];
		for (const input of inputs) {
			expect(clientParseTagWords(input)).toEqual(parseTagWords(input));
		}
	});

	it('joinTagWords agrees', () => {
		expect(clientJoinTagWords(['Git', '+rca!', 'git'])).toBe(joinTagWords(['Git', '+rca!', 'git']));
	});
});
