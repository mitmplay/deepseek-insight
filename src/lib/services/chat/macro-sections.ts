/**
 * macro-sections (2026-08-29) — the Sectioned Row compiler: one pure
 * function that reads a saved shelf row the way its author wrote it, as
 * SECTIONS, not lines.
 *
 * ADR: dev/architectural-decission/2026-08-29 - The Sectioned Row —
 *      The Macro Reads Blocks, Not Lines.md §2 (the grammar) and §3 D11
 *      (one pure compiler replaces the runner's line-splitter).
 * Spec: dev/specs/2026-08-29 - DSI Sectioned Row Macro (Wave 1, task 1.1).
 *
 * Grammar (ADR §2), top to bottom, one line at a time:
 *   - An INSTRUCTION line starts a section. A line is an instruction
 *     when parseCommand recognizes it (a `@session-<uuid>` mention,
 *     `/new …`, `/permission …`) or when it starts with `?` (a shelf
 *     lookup). These are exactly the lines the runner already routes —
 *     the grammar changes what happens AROUND them, never what they mean.
 *   - A MENTION line opens a mention section: its message is the inline
 *     text after the id plus the non-blank lines that follow; the message
 *     closes at the first blank line, the next instruction line, or the
 *     end of the row — whichever comes first (a blank means "done talking
 *     to THAT session"; a second message is a second mention line, ADR §6.2).
 *   - A COMMAND or `?` line is a one-line section, exactly as today
 *     (recognized-but-invalid shapes like `/new foo bar` stay one-liners
 *     and fail loud at feed time — D12).
 *   - Everything else is PLAIN TEXT: plain lines coalesce into ONE
 *     send-block — interior blank lines are paragraph breaks and are
 *     preserved verbatim; leading and trailing blank lines are padding
 *     and are trimmed. A send-block POSTs exactly once with its newlines
 *     intact (one block = one turn = one ledger entry).
 *   - Blank lines never create sections and never appear at a block's
 *     edges; a blank-only row compiles to an empty list.
 *   - A line parseCommand does NOT recognize stays literal text, always
 *     (the parser's own passthrough rule: `/usr/bin/python` and
 *     `@channel hi` are prose, D12).
 *
 * Purity (D11): rows in, records out — no I/O, no reactivity, no fetch,
 * no module state. Imports only the parser primitives; the compiler is
 * table-testable precisely because its whole surface is this function.
 */

import { parseCommand, type ParsedCommand } from './command-parser';

/** The four section kinds a compiled row can contain (ADR D11). */
export type SectionKind = 'mention-block' | 'command' | 'query' | 'send-block';

/** One compiled section of a saved row. */
export interface SectionRecord {
	/** The section's kind. `-block` kinds span multiple row lines; the
	 *  runner strips the suffix when it maps onto the sheet's record
	 *  kind (`send-block` → `send`, `mention-block` → `mention`;
	 *  `command` and `query` pass through — D14). */
	kind: SectionKind;
	/** The section's first line, trimmed — what the run sheet and the
	 *  chip show (the chip names the next unfed section by it). */
	display: string;
	/** The text the section SENDS: the mention's joined message (inline
	 *  remainder + following lines) or the block's verbatim text; for
	 *  one-liners, the line itself. Newlines stay intact — the runner
	 *  hands this string to the executor as ONE unit. */
	sendText: string;
	/** Mention sections only — the captured session id (the uuid tail,
	 *  lowercased, exactly as parseCommand reports it). */
	mentionSessionId?: string;
	/** Mention sections only — the correlation id parsed from a leading
	 *  `_a2a_:<id>;` signature token on the mention line, when present;
	 *  the signature itself never reaches sendText. */
	a2aId?: string;
	/** How many row lines the section spans (minimum 1). A block counts
	 *  as ONE section regardless of this number — `chat.macro.maxLines`
	 *  caps sections, not lines (D15). */
	lineCount: number;
}

/** Is this trimmed line an instruction? (parseCommand-known or `?`.)
 *  Under `slash` (the typed-run flag, ADR The Typed Run D2) a leading-`/`
 *  line is ALWAYS a boundary — even when parseCommand returns null — so
 *  one unknown `/token` line feeds as its own one-line send. */
function isInstruction(line: string, slash = false): boolean {
	return parseCommand(line) !== null || line.startsWith('?') || (slash && line.startsWith('/'));
}

/** Close the mention's message at the first blank line, the next
 *  instruction line, or the end of the row — whichever comes first. */
function messageEndsAt(lines: string[], from: number, slash = false): number {
	let j = from;
	while (j < lines.length && lines[j] !== '' && !isInstruction(lines[j], slash)) j += 1;
	return j;
}

/**
 * Is this draft a TYPED RUN? (ADR The Typed Run 2026-09-16, D1.) Pure:
 * true only when EVERY non-blank line is directive — starts with `/`
 * (command-or-skill attempt), `@` (mention), or `?` (shelf lookup) —
 * and there are at least TWO non-blank lines. Prose, mixed prose+slash
 * drafts, and every single-line draft fail and take today's whole-draft
 * path unchanged. Blank lines never count and never break the match;
 * per-line trim (same as the compiler) absorbs CRLF. No I/O, no
 * reactivity — table-testable like compileRow.
 */
export function isTypedRun(text: string): boolean {
	const directives = text
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l !== '');
	if (directives.length < 2) return false;
	return directives.every((l) => l.startsWith('/') || l.startsWith('@') || l.startsWith('?'));
}

/**
 * Compile a saved row's text into sections. Pure: the same text always
 * yields the same records; blank-only input yields an empty list (the
 * runner refuses an empty compile at start — no fetch fires, Wave 2).
 */
export function compileRow(
	text: string,
	opts: { slashBoundaries?: boolean } = {}
): SectionRecord[] {
	// ADR The Typed Run 2026-09-16, D2: the ONE flagged divergence from the
	// pinned shelf grammar (Sectioned Row D12) — opt-in, typed path only.
	// Default call sites (the runner's shelf route) never pass the flag and
	// get byte-identical output for every input.
	const slash = opts.slashBoundaries === true;
	// Per-line trim first: rows arrive \n-separated, and the trim is what
	// keeps a stray \r (CRLF editors) from ever leaking into a send.
	const lines = text.split('\n').map((l) => l.trim());
	const sections: SectionRecord[] = [];

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];

		// Padding — blank lines never create sections.
		if (line === '') {
			i += 1;
			continue;
		}

		// Instruction lines start sections (and close any open block).
		const command: ParsedCommand | null = parseCommand(line);
		if (command !== null) {
			if (command.type === 'mention') {
				// The message: inline remainder (signature-stripped by the
				// parser) plus the following non-blank, non-instruction lines.
				const end = messageEndsAt(lines, i + 1, slash);
				const tail = lines.slice(i + 1, end);
				const messageLines = command.args === '' ? tail : [command.args, ...tail];
				sections.push({
					kind: 'mention-block',
					display: line,
					sendText: messageLines.join('\n'),
					mentionSessionId: command.sessionId,
					...(command.a2aId !== undefined ? { a2aId: command.a2aId } : {}),
					lineCount: 1 + tail.length
				});
				i = end;
				continue;
			}
			sections.push({ kind: 'command', display: line, sendText: line, lineCount: 1 });
			i += 1;
			continue;
		}
		if (line.startsWith('?')) {
			sections.push({ kind: 'query', display: line, sendText: line, lineCount: 1 });
			i += 1;
			continue;
		}

		// The Typed Run D2: under the flag an unknown `/token` line (the
		// parser's passthrough rule preserved PER LINE) is its own one-line
		// send — granularity changes, never the line's meaning. Without the
		// flag this branch never fires and the shelf grammar is untouched.
		if (slash && line.startsWith('/')) {
			sections.push({ kind: 'send-block', display: line, sendText: line, lineCount: 1 });
			i += 1;
			continue;
		}

		// Plain text coalesces into ONE send-block until the next
		// instruction line or the end of the row. Interior blank lines
		// ride along (paragraph breaks); edge blanks are trimmed below.
		let end = i + 1;
		while (end < lines.length && !isInstruction(lines[end], slash)) end += 1;
		const block = lines.slice(i, end);
		while (block.length > 0 && block[0] === '') block.shift();
		while (block.length > 0 && block[block.length - 1] === '') block.pop();
		if (block.length > 0) {
			sections.push({
				kind: 'send-block',
				display: block[0],
				sendText: block.join('\n'),
				lineCount: block.length
			});
		}
		i = end;
	}

	return sections;
}
