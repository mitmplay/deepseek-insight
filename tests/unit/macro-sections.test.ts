/**
 * macro-sections tests (2026-08-29) — the Sectioned Row grammar table:
 * the ADR's full rows-in → records-out surface for compileRow, pure
 * (no DOM, no fetch, no reactivity — the module under test has none).
 *
 * Spec: dev/specs/2026-08-29 - DSI Sectioned Row Macro, task 1.1-T.
 * ADR §2 (the grammar), §8 unit column (the table), D11/D12 (edges).
 */
import { describe, expect, it } from 'vitest';
import { compileRow } from '$lib/services/chat/macro-sections';

/** The ADR's motivating row, §1 verbatim (3 lines of text + blank + block). */
const MOTIVATING_ROW = [
	'@session-482e6f9b-aec3-4d63-b841-98f80eab33fb',
	'Hi how are you?',
	'what % context use',
	'',
	'/new @app-dev',
	'- load project folder `~/agentic-ai/deepseek-harness` aka DSH',
	'- load project folder `~/agentic-ai/deepseek-insight` aka DSI',
	'- load project folder `~/openclaw-insight` aka OCI'
].join('\n');

/** The ADR §2 four-record row — padding blanks + a trailing /new @code. */
const FOUR_SECTION_ROW = [
	'@session-482e6f9b-aec3-4d63-b841-98f80eab33fb',
	'Hi how are you?',
	'what % context use',
	'',
	'/new @app-dev',
	'',
	'- load project folder `~/agentic-ai/deepseek-harness` aka DSH',
	'- load project folder `~/agentic-ai/deepseek-insight` aka DSI',
	'- load project folder `~/openclaw-insight` aka OCI',
	'',
	'/new @code'
].join('\n');

describe('compileRow — the worked rows (ADR §2)', () => {
	it('compiles the motivating row to exactly 3 sections', () => {
		const sections = compileRow(MOTIVATING_ROW);
		expect(sections).toHaveLength(3);
		expect(sections.map((s) => s.kind)).toEqual(['mention-block', 'command', 'send-block']);
	});

	it('section 1 — mention-block carries the joined two-line message', () => {
		const [mention] = compileRow(MOTIVATING_ROW);
		expect(mention.mentionSessionId).toBe('482e6f9b-aec3-4d63-b841-98f80eab33fb');
		expect(mention.sendText).toBe('Hi how are you?\nwhat % context use');
		expect(mention.display).toBe('@session-482e6f9b-aec3-4d63-b841-98f80eab33fb');
		expect(mention.lineCount).toBe(3);
		expect(mention.a2aId).toBeUndefined();
	});

	it('section 2 — /new @app-dev is a one-line command section', () => {
		const [, command] = compileRow(MOTIVATING_ROW);
		expect(command.kind).toBe('command');
		expect(command.display).toBe('/new @app-dev');
		expect(command.sendText).toBe('/new @app-dev');
		expect(command.lineCount).toBe(1);
	});

	it('section 3 — the bullets are ONE send-block, newlines intact', () => {
		const [, , block] = compileRow(MOTIVATING_ROW);
		expect(block.kind).toBe('send-block');
		expect(block.display).toBe('- load project folder `~/agentic-ai/deepseek-harness` aka DSH');
		expect(block.sendText).toBe(
			[
				'- load project folder `~/agentic-ai/deepseek-harness` aka DSH',
				'- load project folder `~/agentic-ai/deepseek-insight` aka DSI',
				'- load project folder `~/openclaw-insight` aka OCI'
			].join('\n')
		);
		expect(block.lineCount).toBe(3);
	});

	it('compiles the 4-section row: blanks pad, trailing /new is legal', () => {
		const sections = compileRow(FOUR_SECTION_ROW);
		expect(sections.map((s) => s.kind)).toEqual([
			'mention-block',
			'command',
			'send-block',
			'command'
		]);
		const [, , block, trailing] = sections;
		// The blank after /new @app-dev and before /new @code are padding:
		// trimmed off the block's edges, never sections of their own.
		expect(block.sendText).not.toContain('\n\n');
		expect(block.sendText.startsWith('- load project')).toBe(true);
		expect(block.sendText.endsWith('aka OCI')).toBe(true);
		expect(trailing.display).toBe('/new @code');
		expect(trailing.lineCount).toBe(1);
	});
});

describe('compileRow — mention message closing rules', () => {
	it('a blank line closes the mention; the following text is a new section', () => {
		const sections = compileRow(
			'@session-482e6f9b-aec3-4d63-b841-98f80eab33fb\nping\n\nplain after the blank'
		);
		expect(sections).toHaveLength(2);
		expect(sections[0].kind).toBe('mention-block');
		expect(sections[0].sendText).toBe('ping');
		expect(sections[1].kind).toBe('send-block');
		expect(sections[1].sendText).toBe('plain after the blank');
	});

	it('an instruction line closes the mention', () => {
		const sections = compileRow(
			'@session-482e6f9b-aec3-4d63-b841-98f80eab33fb\nping\n/new @code'
		);
		expect(sections.map((s) => s.kind)).toEqual(['mention-block', 'command']);
		expect(sections[0].sendText).toBe('ping');
	});

	it('EOF closes the mention (message runs to the last line)', () => {
		const sections = compileRow(
			'@session-482e6f9b-aec3-4d63-b841-98f80eab33fb\none\ntwo\nthree'
		);
		expect(sections).toHaveLength(1);
		expect(sections[0].sendText).toBe('one\ntwo\nthree');
	});

	it('bare mention at EOF is kept as a section with empty sendText', () => {
		const sections = compileRow('@session-482e6f9b-aec3-4d63-b841-98f80eab33fb');
		expect(sections).toHaveLength(1);
		expect(sections[0].kind).toBe('mention-block');
		expect(sections[0].sendText).toBe('');
		expect(sections[0].lineCount).toBe(1);
		expect(sections[0].mentionSessionId).toBe('482e6f9b-aec3-4d63-b841-98f80eab33fb');
	});

	it('inline message text is the mention message\u2019s first line', () => {
		const sections = compileRow(
			'@session-482e6f9b-aec3-4d63-b841-98f80eab33fb inline question\nfollow-up line'
		);
		expect(sections).toHaveLength(1);
		expect(sections[0].sendText).toBe('inline question\nfollow-up line');
		expect(sections[0].lineCount).toBe(2);
	});

	it('an inline _a2a_: signature lands on the record, never in sendText', () => {
		const sections = compileRow(
			'@session-482e6f9b-aec3-4d63-b841-98f80eab33fb _a2a_:a2a-0123456789abcdef; the task\nand its context'
		);
		expect(sections).toHaveLength(1);
		expect(sections[0].a2aId).toBe('a2a-0123456789abcdef');
		expect(sections[0].sendText).toBe('the task\nand its context');
	});
});

describe('compileRow — one-liners', () => {
	it('commands are one-line sections: /permission', () => {
		const sections = compileRow('/permission read-only');
		expect(sections).toEqual([
			{ kind: 'command', display: '/permission read-only', sendText: '/permission read-only', lineCount: 1 }
		]);
	});

	it('recognized-invalid `/new foo bar` stays a one-liner (fails loud at feed)', () => {
		const sections = compileRow('/new foo bar');
		expect(sections).toEqual([
			{ kind: 'command', display: '/new foo bar', sendText: '/new foo bar', lineCount: 1 }
		]);
	});

	it('?key is a one-line query section', () => {
		const sections = compileRow('?oci');
		expect(sections).toEqual([{ kind: 'query', display: '?oci', sendText: '?oci', lineCount: 1 }]);
	});

	it('a query between blocks does not absorb them', () => {
		const sections = compileRow('first line\n?oci\nsecond line');
		expect(sections.map((s) => s.kind)).toEqual(['send-block', 'query', 'send-block']);
	});
});

describe('compileRow — plain blocks', () => {
	it('consecutive plain lines coalesce into ONE send-block', () => {
		const sections = compileRow('one\ntwo\nthree');
		expect(sections).toHaveLength(1);
		expect(sections[0].kind).toBe('send-block');
		expect(sections[0].sendText).toBe('one\ntwo\nthree');
		expect(sections[0].lineCount).toBe(3);
	});

	it('interior blank lines are preserved (paragraph breaks), edges trimmed', () => {
		const sections = compileRow('\n\npara one\n\npara two\n\n');
		expect(sections).toHaveLength(1);
		expect(sections[0].sendText).toBe('para one\n\npara two');
		expect(sections[0].lineCount).toBe(3);
		expect(sections[0].display).toBe('para one');
	});

	it('an instruction line closes an open block', () => {
		const sections = compileRow('alpha\nbeta\n/new @code\ngamma');
		expect(sections.map((s) => s.kind)).toEqual(['send-block', 'command', 'send-block']);
		expect(sections[0].sendText).toBe('alpha\nbeta');
		expect(sections[2].sendText).toBe('gamma');
	});

	it('a single plain line is one one-line send-block (W2 byte-identical base)', () => {
		const sections = compileRow('hello world');
		expect(sections).toEqual([
			{ kind: 'send-block', display: 'hello world', sendText: 'hello world', lineCount: 1 }
		]);
	});
});

describe('compileRow — literal passthrough (D12)', () => {
	it("'@channel hi' is NOT a mention — plain text", () => {
		const sections = compileRow('@channel hi');
		expect(sections).toHaveLength(1);
		expect(sections[0].kind).toBe('send-block');
		expect(sections[0].sendText).toBe('@channel hi');
		expect(sections[0].mentionSessionId).toBeUndefined();
	});

	it("'/usr/bin/python' is NOT a command — plain text", () => {
		const sections = compileRow('/usr/bin/python');
		expect(sections).toHaveLength(1);
		expect(sections[0].kind).toBe('send-block');
		expect(sections[0].sendText).toBe('/usr/bin/python');
	});

	it('unrecognized tokens inside a block stay literal', () => {
		const sections = compileRow('run /usr/bin/python with @channel hi');
		expect(sections).toHaveLength(1);
		expect(sections[0].sendText).toBe('run /usr/bin/python with @channel hi');
	});
});

describe('compileRow — blank, empty, and CRLF rows', () => {
	it('an all-blank row compiles to an empty list', () => {
		expect(compileRow('')).toEqual([]);
		expect(compileRow('\n')).toEqual([]);
		expect(compileRow('   \n\t\n  \n')).toEqual([]);
	});

	it('CRLF rows: \\r never leaks into a send', () => {
		const crlf = '@session-482e6f9b-aec3-4d63-b841-98f80eab33fb\r\nhi\r\n\r\n/new @code\r\nplain\r\ntext';
		const sections = compileRow(crlf);
		expect(sections.map((s) => s.kind)).toEqual(['mention-block', 'command', 'send-block']);
		expect(sections[0].sendText).toBe('hi');
		expect(sections[2].sendText).toBe('plain\ntext');
	});

	it('edge whitespace is trimmed per line', () => {
		const sections = compileRow('  hello  \n  world  ');
		expect(sections[0].sendText).toBe('hello\nworld');
	});
});

describe('compileRow — purity', () => {
	it('returns fresh arrays; the input string is never mutated', () => {
		const text = 'a\n\nb';
		const a = compileRow(text);
		const b = compileRow(text);
		expect(a).not.toBe(b); // fresh array each call, no cached module state
		expect(a).toEqual(b);
		expect(text).toBe('a\n\nb');
	});
});
