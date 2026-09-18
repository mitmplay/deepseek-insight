/**
 * command-workspace-parser tests (2026-09-15, The Workspace Command ADR
 * D1/D2/D5) — the /workspace grammar and the widened /new grammar.
 *
 * Blast-radius anchors first: the four PRE-EXISTING /new shapes must keep
 * byte-identical captures (the /new regex rewrite is the composer's
 * highest-blast-radius change — Tasks 1.1-T), then the new captures.
 */
import { describe, expect, it } from 'vitest';
import { parseCommand } from '$lib/services/chat/command-parser';

describe('parseCommand — /new regression anchors (four pinned shapes, byte-identical)', () => {
	it('bare /new', () => {
		const r = parseCommand('/new');
		expect(r).toEqual({ type: 'new', args: '' });
		expect('agentId' in (r ?? {})).toBe(false);
		expect('ws' in (r ?? {})).toBe(false);
		expect('addPanel' in (r ?? {})).toBe(false);
	});

	it('/new @id', () => {
		expect(parseCommand('/new @app-dev')).toEqual({ type: 'new', args: '', agentId: 'app-dev' });
	});

	it('/new --add', () => {
		const r = parseCommand('/new --add');
		expect(r).toEqual({ type: 'new', args: '', addPanel: true });
		expect('agentId' in (r ?? {})).toBe(false);
	});

	it('/new @id --add', () => {
		expect(parseCommand('/new @app-dev --add')).toEqual({
			type: 'new',
			args: '',
			agentId: 'app-dev',
			addPanel: true
		});
	});

	it('malformed shapes keep raw args (pinned); a lone name is now the D5 ws token', () => {
		// D5: a single non-flag token IS the workspace shape — the executor
		// resolves it against the registry and notes a miss (never a guess).
		expect(parseCommand('/new leftover')).toEqual({ type: 'new', args: '', ws: 'leftover' });
		expect(parseCommand('/new @a b c')).toEqual({ type: 'new', args: '@a b c' });
		expect(parseCommand('/new @ cordis')).toEqual({ type: 'new', args: '@ cordis' });
		expect(parseCommand('/new --ADD')).toEqual({ type: 'new', args: '--ADD' });
		expect(parseCommand('/new --add @app-dev')).toEqual({ type: 'new', args: '--add @app-dev' });
		expect(parseCommand('/new --add extra')).toEqual({ type: 'new', args: '--add extra' });
	});
});

describe('parseCommand — /new workspace token (2026-09-15, ADR D5)', () => {
	it('/new ws captures ws, no agentId key', () => {
		const r = parseCommand('/new workspace-ai');
		expect(r).toEqual({ type: 'new', args: '', ws: 'workspace-ai' });
		expect('agentId' in (r ?? {})).toBe(false);
	});

	it('/new @id ws captures both', () => {
		expect(parseCommand('/new @ptc workspace-ai')).toEqual({
			type: 'new',
			args: '',
			agentId: 'ptc',
			ws: 'workspace-ai'
		});
	});

	it('/new ws --add captures ws + flag', () => {
		expect(parseCommand('/new workspace-ai --add')).toEqual({
			type: 'new',
			args: '',
			ws: 'workspace-ai',
			addPanel: true
		});
	});

	it('/new @id ws --add captures all three', () => {
		expect(parseCommand('/new @ptc workspace-ai --add')).toEqual({
			type: 'new',
			args: '',
			agentId: 'ptc',
			ws: 'workspace-ai',
			addPanel: true
		});
	});

	it('ws case preserved verbatim; trim/multi-space tolerant', () => {
		expect(parseCommand('  /new @ptc  Workspace-AI  ')).toEqual({
			type: 'new',
			args: '',
			agentId: 'ptc',
			ws: 'Workspace-AI'
		});
	});

	it('a path-shaped token is a valid ws token (canon match is the executor\'s job)', () => {
		expect(parseCommand('/new ~/workspace-ai')).toEqual({
			type: 'new',
			args: '',
			ws: '~/workspace-ai'
		});
	});

	it('more than one ws token keeps raw args (never a guess)', () => {
		expect(parseCommand('/new ws1 ws2')).toEqual({ type: 'new', args: 'ws1 ws2' });
	});
});

describe('parseCommand — /workspace (2026-09-15, ADR D1/D2)', () => {
	it('one token: wsPath captured, no wsName key', () => {
		const r = parseCommand('/workspace ~/workspace-ai');
		expect(r).toEqual({ type: 'workspace', args: '', wsPath: '~/workspace-ai' });
		expect('wsName' in (r ?? {})).toBe(false);
	});

	it('two tokens: wsPath + wsName, both case-preserved', () => {
		expect(parseCommand('/workspace ~/workspace-ai MyWS')).toEqual({
			type: 'workspace',
			args: '',
			wsPath: '~/workspace-ai',
			wsName: 'MyWS'
		});
	});

	it('--add as the second token stays a NAME (no flag on /workspace, D2)', () => {
		expect(parseCommand('/workspace ~/x --add')).toEqual({
			type: 'workspace',
			args: '',
			wsPath: '~/x',
			wsName: '--add'
		});
	});

	it('bare keeps raw empty args — the MISSING path is the executor usage note', () => {
		const r = parseCommand('/workspace');
		expect(r).toEqual({ type: 'workspace', args: '' });
		expect('wsPath' in (r ?? {})).toBe(false);
	});

	it('a bare ? keeps raw args so the ? help intent routes (D6)', () => {
		expect(parseCommand('/workspace ?')).toEqual({ type: 'workspace', args: '?' });
	});

	it('3+ tokens keep raw args (paths with spaces are a documented v1 give-up)', () => {
		expect(parseCommand('/workspace /a/b c d')).toEqual({ type: 'workspace', args: '/a/b c d' });
		expect(parseCommand('/workspace /a/b/c --add x')).toEqual({
			type: 'workspace',
			args: '/a/b/c --add x'
		});
	});

	it('case-insensitive token, trim-tolerant; path case verbatim', () => {
		expect(parseCommand('  /WORKSPACE ~/WorkSpaCe-AI  ')).toEqual({
			type: 'workspace',
			args: '',
			wsPath: '~/WorkSpaCe-AI'
		});
	});
});

describe('parseCommand — neighbor gestures untouched (spot checks)', () => {
	it('mentions still parse', () => {
		const UUID = '1d15d442-94bc-422c-afb1-e870db9906a3';
		expect(parseCommand('@session-' + UUID + ' hi')).toEqual({
			type: 'mention',
			sessionId: UUID,
			args: 'hi'
		});
	});

	it('near-miss tokens stay null passthrough', () => {
		expect(parseCommand('/workspacex ~/x')).toBeNull();
		expect(parseCommand('/workspac')).toBeNull();
	});

	it('unknown slash lines stay ordinary text', () => {
		expect(parseCommand('/usr/bin/python')).toBeNull();
	});
});
