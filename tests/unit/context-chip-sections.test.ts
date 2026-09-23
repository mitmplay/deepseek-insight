import { describe, expect, it } from 'vitest';
import { chipNameOf, snapshotSectionsOf } from '$lib/utils/context-chip';
import * as m from '$lib/paraglide/messages';

/** Live-captured shape (2026-09-23, session seq 17 ledger event — the
 * probe source for the Section Split ADR). */
const CAPTURED = {
	kind: 'plugin',
	plugin: '@deepseek-ai/dsh-system-prompt',
	form: 'snapshot',
	sections: [
		{ name: 'sandbox:policy', text: 'Current DSH file policy: danger-full-access.' },
		{ name: 'approval:policy', text: 'Approval prompts are disabled in this session.' }
	]
};

describe('snapshotSectionsOf (Section Split D1 — all-or-nothing)', () => {
	it('parses the live-captured runtime-context source', () => {
		expect(snapshotSectionsOf(CAPTURED)).toEqual([
			{ name: 'sandbox:policy', text: 'Current DSH file policy: danger-full-access.' },
			{ name: 'approval:policy', text: 'Approval prompts are disabled in this session.' }
		]);
	});

	it('preserves wire order and exact bytes', () => {
		const sections = snapshotSectionsOf(CAPTURED)!;
		expect(sections.map((s) => s.name)).toEqual(['sandbox:policy', 'approval:policy']);
		expect(sections[0]!.text.startsWith('Current DSH file policy')).toBe(true);
	});

	it.each([
		['empty name', { sections: [{ name: '', text: 'x' }] }],
		['non-string text', { sections: [{ name: 'a', text: 3 }] }],
		['missing text', { sections: [{ name: 'a' }] }],
		['non-record element', { sections: ['sandbox:policy'] }],
		['null element', { sections: [null] }],
		['non-array sections', { sections: 'sandbox:policy' }],
		['empty array', { sections: [] }]
	])('discards the whole list on %s', (_label, source) => {
		expect(snapshotSectionsOf(source as Record<string, unknown>)).toBeUndefined();
	});

	it('returns undefined without a source', () => {
		expect(snapshotSectionsOf(undefined)).toBeUndefined();
	});
});

describe('existing chip readers regressions', () => {
	it('chipNameOf is untouched by the new reader', () => {
		expect(chipNameOf('plugin', { plugin: 'compact' })).toBe('compact');
		expect(chipNameOf('runtime-context', CAPTURED)).toBeUndefined();
	});
});

describe('ctxSnapshotSupersedes catalog key (D5)', () => {
	it('resolves through paraglide as non-empty text', () => {
		const text = m.ctxSnapshotSupersedes();
		expect(typeof text).toBe('string');
		expect(text.length).toBeGreaterThan(0);
	});
	it('is defined in every catalog source file', async () => {
		const fs = await import('node:fs');
		for (const locale of ['en', 'zh', 'id']) {
			const raw = fs.readFileSync('messages/' + locale + '.json', 'utf8');
			expect(JSON.parse(raw)).toHaveProperty('ctxSnapshotSupersedes');
		}
	});
});
