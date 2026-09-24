/**
 * command-parser tests (2026-08-25) — the composer's slash intercept,
 * ported from OCI's parser semantics (tests/unit/command-parser.test.ts
 * there): exact-token case-insensitive match, trim-tolerant, unknown →
 * null passthrough (never a client-side rejection).
 */
import { describe, expect, it } from 'vitest';
import { parseCommand, loadinjectedCommand } from '$lib/services/chat/command-parser';
import { mintA2aId } from '$lib/services/chat/a2a-protocol';

describe('parseCommand — known commands', () => {
	it('parses /permission with a preset arg', () => {
		expect(parseCommand('/permission read-only')).toEqual({ type: 'permission', args: 'read-only' });
	});

	it('parses bare /permission (current-preset query)', () => {
		expect(parseCommand('/permission')).toEqual({ type: 'permission', args: '' });
	});

	it('parses bare /new', () => {
		expect(parseCommand('/new')).toEqual({ type: 'new', args: '' });
	});

	it('bare /new is byte-identical to the shipped shape (no agentId key)', () => {
		const r = parseCommand('/new');
		expect(r).toEqual({ type: 'new', args: '' });
		expect('agentId' in (r ?? {})).toBe(false);
	});

	it('is case-insensitive on the command token, preserves arg case', () => {
		expect(parseCommand('/PERMISSION Read-Only')).toEqual({ type: 'permission', args: 'Read-Only' });
		expect(parseCommand('/New')).toEqual({ type: 'new', args: '' });
	});

	it('is trim-tolerant (leading/trailing whitespace)', () => {
		expect(parseCommand('  /permission read-only  ')).toEqual({ type: 'permission', args: 'read-only' });
	});

	it('carries multi-word args verbatim after the first whitespace run', () => {
		expect(parseCommand('/permission  danger-full-access   extra')).toEqual({
			type: 'permission',
			args: 'danger-full-access   extra'
		});
	});
});

describe('parseCommand — passthrough (null)', () => {
	it.each([
		'',
		'   ',
		'hello world',
		'/help',
		'/usr/bin/python',
		'/newfile.txt',
		'/permissionx read-only'
	])('returns null for %j', (text) => {
		expect(parseCommand(text)).toBeNull();
	});

	it('parses a single token as the workspace token (2026-09-15, ADR D5 — was raw args pre-D5)', () => {
		expect(parseCommand('/new session')).toEqual({ type: 'new', args: '', ws: 'session' });
	});

	describe('parseCommand — /new @agent override (2026-08-26)', () => {
		it('captures the preset id from /new @<id>', () => {
			expect(parseCommand('/new @cordis')).toEqual({ type: 'new', args: '', agentId: 'cordis' });
		});

		it('keeps slug-shaped ids intact (dashes, digits)', () => {
			expect(parseCommand('/new @app-dev')).toEqual({ type: 'new', args: '', agentId: 'app-dev' });
			expect(parseCommand('/new @dev2')).toEqual({ type: 'new', args: '', agentId: 'dev2' });
		});

		it('preserves the id case verbatim (host slugs are never canonicalized)', () => {
			expect(parseCommand('/New @Cordis')).toEqual({ type: 'new', args: '', agentId: 'Cordis' });
		});

		it('@id + one token is the D5 workspace shape; a bare @ keeps raw args', () => {
			expect(parseCommand('/new @a b')).toEqual({ type: 'new', args: '', agentId: 'a', ws: 'b' });
			expect(parseCommand('/new @ cordis')).toEqual({ type: 'new', args: '@ cordis' });
		});

		it('an @session-<uuid> arg parses as an agent id token (the host rejects it)', () => {
			// /new's grammar knows agents, not sessions — a session-shaped arg
			// travels as a preset id and fails create with preset-not-found.
			expect(parseCommand('/new @session-1d15d442-94bc-422c-afb1-e870db9906a3')).toEqual({
				type: 'new',
				args: '',
				agentId: 'session-1d15d442-94bc-422c-afb1-e870db9906a3'
			});
		});

		describe('parseCommand — /new --add (2026-09-06, panel-to-the-right)', () => {
			it('bare --add: flag captured, no agentId key', () => {
				const r = parseCommand('/new --add');
				expect(r).toEqual({ type: 'new', args: '', addPanel: true });
				expect('agentId' in (r ?? {})).toBe(false);
			});

			it('@agent + --add: both captured', () => {
				expect(parseCommand('/new @app-dev --add')).toEqual({
					type: 'new',
					args: '',
					agentId: 'app-dev',
					addPanel: true
				});
			});

			it('flag order is fixed — trailing only; anything else keeps the raw shape', () => {
				expect(parseCommand('/new --add @app-dev')).toEqual({ type: 'new', args: '--add @app-dev' });
				expect(parseCommand('/new --ADD')).toEqual({ type: 'new', args: '--ADD' });
				expect(parseCommand('/new --add extra')).toEqual({ type: 'new', args: '--add extra' });
			});

			it('plain /new carries no addPanel key (byte-shaped default)', () => {
				const r = parseCommand('/new');
				expect('addPanel' in (r ?? {})).toBe(false);
			});
		});
	});

	it('does not treat @mentions or paths as commands', () => {
		expect(parseCommand('@/permission')).toBeNull();
		expect(parseCommand('//new')).toBeNull();
	});
});

describe('parseCommand — @session mention (2026-08-26, agent-to-agent)', () => {
	const UUID = '1d15d442-94bc-422c-afb1-e870db9906a3';

	it('parses @session-<uuid> with a message', () => {
		expect(parseCommand(`@session-${UUID} say hi agent`)).toEqual({
			type: 'mention',
			sessionId: UUID,
			args: 'say hi agent'
		});
	});

	it('captures only the uuid tail (lowercased, case-insensitive hex)', () => {
		const upper = UUID.toUpperCase();
		expect(parseCommand(`@session-${upper} run tests`)).toEqual({
			type: 'mention',
			sessionId: UUID,
			args: 'run tests'
		});
	});

	it('no message → a mention with empty args (the handler reports usage)', () => {
		expect(parseCommand(`@session-${UUID}`)).toEqual({ type: 'mention', sessionId: UUID, args: '' });
	});

	it('carries multi-word / multi-line messages verbatim after the first whitespace run', () => {
		expect(parseCommand(`@session-${UUID}  please   run   the tests`)).toEqual({
			type: 'mention',
			sessionId: UUID,
			args: 'please   run   the tests'
		});
		expect(parseCommand(`@session-${UUID} line one\nline two`)).toEqual({
			type: 'mention',
			sessionId: UUID,
			args: 'line one\nline two'
		});
	});

	it('is trim-tolerant', () => {
		expect(parseCommand(`   @session-${UUID} hello   `)).toEqual({
			type: 'mention',
			sessionId: UUID,
			args: 'hello'
		});
	});

	it('non-mention @ lines stay ordinary text (never a client-side rejection)', () => {
		expect(parseCommand('@channel see this')).toBeNull();
		expect(parseCommand('@session-xyz not a uuid')).toBeNull();
		expect(parseCommand('@1d15d442-94bc-422c-afb1-e870db9906a3')).toBeNull(); // bare uuid: no session- prefix
		expect(parseCommand('@session-')).toBeNull();
		expect(parseCommand('session-1d15d442-94bc-422c-afb1-e870db9906a3 hi')).toBeNull(); // no @
	});
});

describe('parseCommand — mention + a2a signature (2026-08-25, Task 1.2)', () => {
	const UUID = '1d15d442-94bc-422c-afb1-e870db9906a3';

	it('captures the id and strips the token from a signature’d mention', () => {
		expect(parseCommand(`@session-${UUID} _a2a_:a2a-0123456789abcdef; run the tests`)).toEqual({
			type: 'mention',
			sessionId: UUID,
			args: 'run the tests',
			a2aId: 'a2a-0123456789abcdef'
		});
	});

	it('signature with an empty message → mention with empty args + the id', () => {
		expect(parseCommand(`@session-${UUID} _a2a_:a2a-fedcba9876543210;`)).toEqual({
			type: 'mention',
			sessionId: UUID,
			args: '',
		a2aId: 'a2a-fedcba9876543210'
		});
	});

	it('normalizes an uppercase signature token to the lowercase id', () => {
		expect(parseCommand(`@session-${UUID} _A2A_:A2A-ABCDEF0123456789; hi`)).toEqual({
			type: 'mention',
			sessionId: UUID,
			args: 'hi',
			a2aId: 'a2a-abcdef0123456789'
		});
	});

	it('carries a multiline message after the signature, verbatim', () => {
		expect(parseCommand(`@session-${UUID} _a2a_:a2a-0123456789abcdef; line one\nline two`)).toEqual({
			type: 'mention',
			sessionId: UUID,
			args: 'line one\nline two',
			a2aId: 'a2a-0123456789abcdef'
		});
	});

	it('malformed signature (missing semicolon) is NOT a signature — it stays message text', () => {
		expect(parseCommand(`@session-${UUID} _a2a_:a2a-0123456789abcdef run the tests`)).toEqual({
			type: 'mention',
			sessionId: UUID,
			args: '_a2a_:a2a-0123456789abcdef run the tests'
		});
	});

	it('signature-less mention shape is byte-identical to the shipped behavior (no a2aId key)', () => {
		const r = parseCommand(`@session-${UUID} run the tests`);
		expect(r).toEqual({ type: 'mention', sessionId: UUID, args: 'run the tests' });
		expect('a2aId' in (r ?? {})).toBe(false);
	});

	it('non-leading signature is message text (prose echo, never plumbing)', () => {
		expect(parseCommand(`@session-${UUID} please _a2a_:a2a-0123456789abcdef; run`)).toEqual({
			type: 'mention',
			sessionId: UUID,
			args: 'please _a2a_:a2a-0123456789abcdef; run'
		});
	});

	it('round trip with a minted id: the parsed id is always in mint shape', () => {
		const id = mintA2aId();
		expect(parseCommand(`@session-${UUID} _a2a_:${id}; say hi agent`)).toEqual({
			type: 'mention',
			sessionId: UUID,
			args: 'say hi agent',
			a2aId: id
		});
	});
});


// ── W3 3.1-T — /dsi-prompts (2026-09-06, ADR D7) ──────────────────────
// Regression promotion: the Step-1 probe asserted this token parses to
// null (pre-feature); every case below asserts the INVERSION — the token
// is a known DSI-local command now.
describe('parseCommand — /dsi-prompts (W3 3.1-T)', () => {
	it('bare: type promptmanager, empty args, no addPanel key', () => {
		expect(parseCommand('/dsi-prompts')).toEqual({ type: 'promptmanager', args: '' });
	});
	it('--add is retired grammar: raw args passthrough (Focus Command ADR D2)', () => {
		expect(parseCommand('/dsi-prompts --add')).toEqual({
			type: 'promptmanager',
			args: '--add'
		});
	});
	it('case-insensitive token', () => {
		expect(parseCommand('/Dsi-Prompts')).toEqual({ type: 'promptmanager', args: '' });
	});
	it('leftover keeps the raw args (the handler usage-errors them)', () => {
		expect(parseCommand('/dsi-prompts leftover')).toEqual({
			type: 'promptmanager',
			args: 'leftover'
		});
	});
	it('unknown flags pass through as args (never silently --add)', () => {
		expect(parseCommand('/dsi-prompts --wide')).toEqual({
			type: 'promptmanager',
			args: '--wide'
		});
		expect(parseCommand('/dsi-prompts --add extra')).toEqual({
			type: 'promptmanager',
			args: '--add extra'
		});
	});
});

// ── Settings Panel W3 3.2-T — /dsi-settings + /dsh-settings (2026-09-07 ADR D3/D6) ──

describe('parseCommand — /dsi-settings + /dsh-settings (W3 3.2-T)', () => {
	it('dsisettings bare — type, empty args, no addPanel key', () => {
		expect(parseCommand('/dsi-settings')).toEqual({ type: 'dsisettings', args: '' });
	});
	it('dsisettings --add is retired grammar: raw args passthrough (D2)', () => {
		expect(parseCommand('/dsi-settings --add')).toEqual({ type: 'dsisettings', args: '--add' });
	});
	it('dshsettings bare', () => {
		expect(parseCommand('/dsh-settings')).toEqual({ type: 'dshsettings', args: '' });
	});
	it('dshsettings --add is retired grammar: raw args passthrough (D2)', () => {
		expect(parseCommand('/dsh-settings --add')).toEqual({ type: 'dshsettings', args: '--add' });
	});
	it('case-insensitive tokens', () => {
		expect(parseCommand('/DSI-Settings')).toEqual({ type: 'dsisettings', args: '' });
		expect(parseCommand('/DSH-SETTINGS')).toEqual({ type: 'dshsettings', args: '' });
	});
	it('stray args keep the raw remainder (the handler usage-errors it)', () => {
		expect(parseCommand('/dsi-settings leftover')).toEqual({ type: 'dsisettings', args: 'leftover' });
		expect(parseCommand('/dsh-settings --wide')).toEqual({ type: 'dshsettings', args: '--wide' });
		expect(parseCommand('/dsh-settings --add extra')).toEqual({ type: 'dshsettings', args: '--add extra' });
	});
	it('near-miss tokens are ordinary text, never commands', () => {
		expect(parseCommand('/dsisetting')).toBeNull();
		expect(parseCommand('/dsettings')).toBeNull();
	});
});

// ── Retired Typed Command 1.1-T — /loadinjected typed shapes retire ──
// (2026-09-17, The Retired Typed Command ADR D1/D2: every TYPED shape
// keeps raw args and carries NO filename — the executor's retirement
// guard notes it; the constructor (D3) is the only filename producer.)
describe('parseCommand — /loadinjected (1.1-T, retired typed grammar)', () => {
	it('every typed shape keeps raw args, no filename — bare included', () => {
		expect(parseCommand('/loadinjected AGENTS.md')).toEqual({ type: 'loadinjected', args: 'AGENTS.md' });
		expect(parseCommand('/loadinjected')).toEqual({ type: 'loadinjected', args: '' });
		expect('filename' in (parseCommand('/loadinjected') ?? {})).toBe(false);
		expect('filename' in (parseCommand('/loadinjected AGENTS.md --add') ?? {})).toBe(false);
	});

	it('typed filename + --add, case variants, tolerance — all retirement shapes', () => {
		expect(parseCommand('/loadinjected docs/nested/RULES.md --add')).toEqual({
			type: 'loadinjected',
			args: 'docs/nested/RULES.md --add'
		});
		expect(parseCommand('/LoadInjected Agents.md')).toEqual({ type: 'loadinjected', args: 'Agents.md' });
		expect(parseCommand('  /loadinjected AGENTS.md  --add  ')).toEqual({
			type: 'loadinjected',
			args: 'AGENTS.md  --add'
		});
		expect(parseCommand('/loadinjected --add')).toEqual({ type: 'loadinjected', args: '--add' });
		expect(parseCommand('/loadinjected --ADD')).toEqual({ type: 'loadinjected', args: '--ADD' });
		expect(parseCommand('/loadinjected a b')).toEqual({ type: 'loadinjected', args: 'a b' });
		expect(parseCommand('/loadinjected ?')).toEqual({ type: 'loadinjected', args: '?' });
	});
});

// ── Retired Typed Command 1.1-T — the loadinjectedCommand constructor ──
// (ADR D3: the shelf's only composition path; shape byte-identical to the
// pre-retirement typed product so the executor resolves it unchanged.)
describe('loadinjectedCommand — internal constructor (1.1-T)', () => {
	it('emits the exact internal shape the executor resolves', () => {
		expect(loadinjectedCommand('AGENTS.md')).toEqual({
			type: 'loadinjected',
			args: '',
			filename: 'AGENTS.md'
		});
		expect(loadinjectedCommand('AGENTS.md', { add: true })).toEqual({
			type: 'loadinjected',
			args: '',
			filename: 'AGENTS.md',
			addPanel: true
		});
	});

	it('add omitted or false keeps addPanel absent', () => {
		expect('addPanel' in loadinjectedCommand('AGENTS.md')).toBe(false);
		expect('addPanel' in loadinjectedCommand('AGENTS.md', { add: false })).toBe(false);
	});

	it('preserves the displayPath verbatim (case-sensitive shelf matching)', () => {
		expect(loadinjectedCommand('docs/Nested/RULES.md').filename).toBe('docs/Nested/RULES.md');
	});
});

describe('parseCommand — /dsi-terminal desk grammar (Terminal Desk ADR D2, 2026-09-24)', () => {
	it('parses bare /dsi-terminal with no action key', () => {
		const r = parseCommand('/dsi-terminal');
		expect(r).toEqual({ type: 'terminal', args: '' });
		expect('terminalAction' in (r ?? {})).toBe(false);
	});

	it('parses --new-tab into terminalAction', () => {
		expect(parseCommand('/dsi-terminal --new-tab')).toEqual({
			type: 'terminal',
			args: '',
			terminalAction: 'new-tab'
		});
	});

	it('parses --split-down into terminalAction', () => {
		expect(parseCommand('/dsi-terminal --split-down')).toEqual({
			type: 'terminal',
			args: '',
			terminalAction: 'split-down'
		});
	});

	it('REJECTS both flags together — raw args, no action (usage-error path)', () => {
		const r = parseCommand('/dsi-terminal --new-tab --split-down');
		expect(r).toEqual({ type: 'terminal', args: '--new-tab --split-down' });
		expect('terminalAction' in (r ?? {})).toBe(false);
	});

	it('keeps any other args raw (the /new leftover rule)', () => {
		expect(parseCommand('/dsi-terminal --wide')).toEqual({ type: 'terminal', args: '--wide' });
	});
});

