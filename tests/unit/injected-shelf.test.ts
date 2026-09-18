/**
 * injected-shelf.test.ts — W2 task 2.1-T: the pure shelf selector over
 * dispatched entries (The Loadinjected ADR D6/D7).
 *
 * Contracts pinned:
 * 1. MEMBERSHIP (D7) — the synthetic system-prompt.md (all epochs → ONE
 *    member) plus instructions files from changes[].path; other producers
 *    (runtime-context, plain bubbles) never join; unusable paths skip.
 * 2. ORDER (D6) — system-prompt first, then instructions by first
 *    injection; re-injection never reorders.
 * 3. RESOLUTION (D4) — exact displayPath first, then a UNIQUE basename;
 *    unknown/ambiguous → honest candidates, never a guess.
 */
import { describe, expect, it } from 'vitest';
import type { DsiEntry } from '$lib/types';
import {
	injectedFullPath,
	injectedRecordFor,
	injectedShelfFor,
	resolveInjectedMember,
	SYSTEM_PROMPT_DISPLAY_PATH
} from '$lib/services/conversation/injected-shelf';

function instructionsEntry(
	seq: number,
	paths: string[],
	opts: { baseline?: boolean } = {}
): DsiEntry {
	// Harness-real bundle text (agent-instructions render.ts): one section
	// per file — 'Instructions from: <path>' + blank line + content —
	// inside the <system-reminder> frame.
	const sections = paths.map((p) => `Instructions from: ${p}\n\ncontent of ${p}`);
	return {
		kind: 'user-message',
		id: `u:${seq}`,
		seq,
		time: seq,
		text: `<system-reminder>\n${sections.join('\n\n')}\n</system-reminder>`,
		meta: 'instructions',
		metaSource: {
			kind: 'agent-instructions',
			form: 'instructions',
			baseline: opts.baseline ?? true,
			changes: paths.map((p) => ({ action: 'set', scope: p, path: p, digest: 'd' }))
		}
	};
}

function systemPromptEntry(seq: number, text: string): DsiEntry {
	return { kind: 'system-prompt', id: `sp:${seq}`, seq, time: seq, text };
}

function runtimeContextEntry(seq: number): DsiEntry {
	return {
		kind: 'user-message',
		id: `u:${seq}`,
		seq,
		time: seq,
		text: 'Current runtime context.',
		meta: 'runtime-context',
		metaSource: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot' }
	};
}

function plainEntry(seq: number): DsiEntry {
	return { kind: 'user-message', id: `u:${seq}`, seq, time: seq, text: 'operator text' };
}

describe('injectedShelfFor — membership (D7)', () => {
	it('an empty transcript derives an empty shelf (the button hides)', () => {
		expect(injectedShelfFor([])).toEqual([]);
	});

	it('the synthetic system-prompt member exists when any header epoch carried a system', () => {
		expect(injectedShelfFor([systemPromptEntry(1, 'v1')])).toEqual([
			{
				displayPath: SYSTEM_PROMPT_DISPLAY_PATH,
				label: 'system-prompt.md',
				origin: 'system-prompt',
				firstLoad: true
			}
		]);
	});

	it('header epochs collapse to ONE member — an epoch change is a refresh (D7)', () => {
		const shelf = injectedShelfFor([systemPromptEntry(1, 'v1'), systemPromptEntry(2, 'v2')]);
		expect(shelf).toHaveLength(1);
		expect(shelf[0].origin).toBe('system-prompt');
	});

	it('instructions files join from changes[].path; several changes keep their order', () => {
		const shelf = injectedShelfFor([instructionsEntry(3, ['AGENTS.md', 'docs/nested/RULES.md'])]);
		expect(shelf.map((m) => m.displayPath)).toEqual(['AGENTS.md', 'docs/nested/RULES.md']);
		expect(shelf.map((m) => m.label)).toEqual(['AGENTS.md', 'RULES.md']);
		expect(shelf.every((m) => m.origin === 'instructions')).toBe(true);
	});

	it('other producers never join the shelf — runtime-context and plain bubbles stay out', () => {
		expect(injectedShelfFor([runtimeContextEntry(9), plainEntry(10)])).toEqual([]);
	});

	it('a change without a usable path is skipped, never guessed (wire-boundary data)', () => {
		const entry: DsiEntry = {
			kind: 'user-message',
			id: 'u:11',
			seq: 11,
			time: 11,
			text: 'injected',
			meta: 'instructions',
			metaSource: { changes: [{}, { path: 42 }, { path: '' }, { path: 'OK.md' }] }
		};
		expect(injectedShelfFor([entry]).map((m) => m.displayPath)).toEqual(['OK.md']);
	});
});

describe('injectedShelfFor — operator order (D6)', () => {
	it('system-prompt first, then instructions by first injection; re-injection never reorders', () => {
		const entries = [
			instructionsEntry(1, ['AGENTS.md']),
			systemPromptEntry(2, 'the prompt'),
			instructionsEntry(3, ['AGENTS.md', 'B.md'])
		];
		expect(injectedShelfFor(entries).map((m) => m.displayPath)).toEqual([
			SYSTEM_PROMPT_DISPLAY_PATH,
			'AGENTS.md',
			'B.md'
		]);
	});
});

describe('resolveInjectedMember — the executor resolution (D4)', () => {
	const entries = [
		systemPromptEntry(1, 'the prompt'),
		instructionsEntry(2, ['AGENTS.md']),
		instructionsEntry(3, ['docs/nested/RULES.md'])
	];
	const shelf = injectedShelfFor(entries);

	it('an exact displayPath matches first', () => {
		const r = resolveInjectedMember(entries, 'AGENTS.md');
		expect(r).toEqual({ ok: true, member: shelf[1] });
		expect(resolveInjectedMember(entries, 'docs/nested/RULES.md')).toEqual({
			ok: true,
			member: shelf[2]
		});
	});

	it('a UNIQUE basename resolves by suffix', () => {
		expect(resolveInjectedMember(entries, 'RULES.md')).toEqual({ ok: true, member: shelf[2] });
	});

	it('an ambiguous basename matches nothing — candidates, never a guess', () => {
		const amb = [
			instructionsEntry(1, ['a/README.md']),
			instructionsEntry(2, ['b/README.md'])
		];
		const r = resolveInjectedMember(amb, 'README.md');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.candidates.map((m) => m.displayPath)).toEqual(['a/README.md', 'b/README.md']);
	});

	it('an unknown filename returns the honest candidates list in shelf order', () => {
		const r = resolveInjectedMember(entries, 'NOPE.md');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.candidates).toEqual(shelf);
	});

	it('an empty shelf resolves nothing with empty candidates', () => {
		expect(resolveInjectedMember([], 'AGENTS.md')).toEqual({ ok: false, candidates: [] });
	});
});

// ── Loadinjected — the record accessor with PROVENANCE (ADR D1/D7) ──

describe('injectedRecordFor — the logged record + provenance (ADR D1/D7)', () => {
	it('FIRST-LOAD marking: baseline-envelope files are first load, later ones are not', () => {
		const entries = [
			systemPromptEntry(1, 'epoch one'),
			instructionsEntry(2, ['AGENTS.md']),
			instructionsEntry(3, ['OTHER.md'], { baseline: false })
		];
		const shelf = injectedShelfFor(entries);
		expect(shelf.map((m) => [m.displayPath, m.firstLoad])).toEqual([
			[SYSTEM_PROMPT_DISPLAY_PATH, true],
			['AGENTS.md', true],
			['OTHER.md', false]
		]);
	});

	it('the synthetic member reads the LATEST request/header epoch, WITH provenance', () => {
		const entries = [systemPromptEntry(1, 'epoch one'), systemPromptEntry(2, 'epoch two')];
		expect(injectedRecordFor(entries, SYSTEM_PROMPT_DISPLAY_PATH)).toEqual({
			text: 'epoch two',
			seq: 2,
			time: 2
		});
	});

	it('an instructions member reads the LATEST envelope naming the path, WITH provenance', () => {
		const entries = [
			instructionsEntry(1, ['AGENTS.md']),
			instructionsEntry(2, ['AGENTS.md']),
			instructionsEntry(3, ['OTHER.md'])
		];
		const record = injectedRecordFor(entries, 'AGENTS.md');
		expect(record).not.toBeNull();
		expect(record?.seq).toBe(2); // the newest envelope naming AGENTS.md
		// A path the envelopes never named resolves to nothing.
		expect(injectedRecordFor(entries, 'docs/nested/RULES.md')).toBeNull();
	});

	it('the record’s text is the FILE’S OWN section — never the whole envelope (the club bug)', () => {
		// One envelope bundling TWO files: each member resolves its OWN
		// section, never the other file's content (operator bug report
		// 2026-09-07: '~/.dsh/AGENTS.md' showed the club of both files).
		const text = [
			'<system-reminder>',
			'Instructions from: ~/.dsh/AGENTS.md',
			'',
			'global rule',
			'',
			'Instructions from: AGENTS.md',
			'',
			'workspace rule',
			'</system-reminder>'
		].join('\n');
		const entry: DsiEntry = {
			kind: 'user-message',
			id: 'u:5',
			seq: 5,
			time: 5,
			text,
			meta: 'instructions',
			metaSource: {
				changes: [
					{ path: '~/.dsh/AGENTS.md' },
					{ path: 'AGENTS.md' }
				]
			}
		};
		expect(injectedRecordFor([entry], '~/.dsh/AGENTS.md')?.text).toBe('global rule');
		expect(injectedRecordFor([entry], 'AGENTS.md')?.text).toBe('workspace rule');
	});

	it('Additional/Updated/Removed section styles slice to the file content or notice', () => {
		const text = [
			'<system-reminder>',
			'Additional instructions from: pkg/AGENTS.md',
			'',
			'These instructions apply to work under `pkg`.',
			'',
			'package rule',
			'',
			'Updated instructions from: AGENTS.md',
			'',
			'This file changed after it was loaded. Use the following content instead of the previously loaded instructions from this file.',
			'',
			'newer workspace rule',
			'',
			'Instructions removed: OLD.md',
			'',
			'The previously loaded instructions from this file no longer apply.',
			'</system-reminder>'
		].join('\n');
		const entry: DsiEntry = {
			kind: 'user-message',
			id: 'u:6',
			seq: 6,
			time: 6,
			text,
			meta: 'instructions',
			metaSource: {
				changes: [
					{ path: 'pkg/AGENTS.md' },
					{ path: 'AGENTS.md' },
					{ path: 'OLD.md' }
				]
			}
		};
		// The Additional/Updated preamble is harness framing — sliced off.
		expect(injectedRecordFor([entry], 'pkg/AGENTS.md')?.text).toBe('package rule');
		expect(injectedRecordFor([entry], 'AGENTS.md')?.text).toBe('newer workspace rule');
		expect(injectedRecordFor([entry], 'OLD.md')?.text).toBe(
			'The previously loaded instructions from this file no longer apply.'
		);
	});

	it('a budget-omitted file renders no section — null, never a bundle served as the file', () => {
		const entry: DsiEntry = {
			kind: 'user-message',
			id: 'u:7',
			seq: 7,
			time: 7,
			text: '<system-reminder>\nWorkspace instruction budget 10 bytes: omitted AGENTS.md\n</system-reminder>',
			meta: 'instructions',
			metaSource: { changes: [{ path: 'AGENTS.md' }] }
		};
		expect(injectedRecordFor([entry], 'AGENTS.md')).toBeNull();
	});

	it('an empty transcript resolves nothing — null, never a guess', () => {
		expect(injectedRecordFor([], SYSTEM_PROMPT_DISPLAY_PATH)).toBeNull();
		expect(injectedRecordFor([], 'AGENTS.md')).toBeNull();
	});
});

// ── Loadinjected — the terminal-reachable full path (ADR D6/D7) ──

describe('injectedFullPath — workspace-joined copy value (ADR D6/D7)', () => {
	it('joins the session workspace with the relative display path', () => {
		expect(injectedFullPath('/Users/me/proj', 'AGENTS.md')).toBe('/Users/me/proj/AGENTS.md');
		expect(injectedFullPath('/Users/me/proj', 'docs/nested/RULES.md')).toBe(
			'/Users/me/proj/docs/nested/RULES.md'
		);
	});

	it('tolerates a trailing slash on the workspace; absolute paths pass through', () => {
		expect(injectedFullPath('/Users/me/proj/', 'AGENTS.md')).toBe('/Users/me/proj/AGENTS.md');
		expect(injectedFullPath('/w', '/abs/AGENTS.md')).toBe('/abs/AGENTS.md');
	});

	it('HOME-RELATIVE (~) paths pass through — shells expand ~, never joined onto the cwd', () => {
		expect(injectedFullPath('/Users/me/agentic-ai/deepseek-insight', '~/.dsh/AGENTS.md')).toBe(
			'~/.dsh/AGENTS.md'
		);
	});

	it('a null workspace degrades to the relative path (honest, never invented)', () => {
		expect(injectedFullPath(null, 'AGENTS.md')).toBe('AGENTS.md');
	});
});
