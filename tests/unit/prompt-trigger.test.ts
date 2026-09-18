/**
 * prompt-trigger tests (task 2.1-T): every ADR §4 contract row —
 * activation rules (caret sensitivity, newline, "?" alone), key
 * splitting, record-guard exclusions, preview segmentation (hit spans,
 * overlap resolution, fuzzy word floor 0.5).
 */
import { describe, expect, it } from 'vitest';
import {
	diceSimilarity,
	FUZZY_MIN_LEN,
	getTrigger,
	previewOf,
	previewSegments,
	searchKey,
	shouldRecordPrompt,
	splitKey,
	textPreviewOf,
	TRIGGER_CHARS,
	triggerMode,
	type SuggestedPrompt
} from '$lib/services/chat/prompt-trigger.js';

function row(partial: Partial<SuggestedPrompt> = {}): SuggestedPrompt {
	return {
		id: 1,
		label: null,
		text: 'load project AIP, OCI',
		use_count: 1,
		macro: 0,
		last_used_at: '2026-08-28T00:00:00.000Z',
	tags: '',
		...partial
	};
}

describe('getTrigger — activation (ADR §4)', () => {
	it('activates on "?" first char before caret, returns query including the trigger char', () => {
		expect(getTrigger('?load', 5)).toBe('?load');
		expect(getTrigger('?load skill', 11)).toBe('?load skill');
	});

	it('bare "?" inactive — needs at least one trailing character', () => {
		expect(getTrigger('?', 1)).toBeNull();
	});

	it('newline in before-caret text kills the trigger (single-line finder)', () => {
		expect(getTrigger('?a\nb', 4)).toBeNull();
		expect(getTrigger('hello\n?load', 11)).toBeNull();
	});

	it('caret sensitivity: only text before the caret counts', () => {
		// caret at 2 in "?load": the trigger slice is "?l"
		expect(getTrigger('?load', 2)).toBe('?l');
	});

	it('no trigger char / "?" not at position 0 → null', () => {
		expect(getTrigger('load', 4)).toBeNull();
		expect(getTrigger('a?w', 3)).toBeNull();
		expect(getTrigger('', 0)).toBeNull();
	});

	it('spaces allowed — multi-keyword queries work', () => {
		expect(getTrigger('?load the skill', 15)).toBe('?load the skill');
	});

	describe('getTrigger — ! bang mode (Prompt Macro ADR D1, identical grammar)', () => {
	it('activates on "!" first char before caret, returns query including the bang', () => {
		expect(getTrigger('!oci', 4)).toBe('!oci');
		expect(getTrigger('!new routine', 12)).toBe('!new routine');
	});

	it('bare "!" inactive — needs at least one trailing character', () => {
		expect(getTrigger('!', 1)).toBeNull();
	});

	it('newline in before-caret text kills the bang trigger (single-line finder)', () => {
		expect(getTrigger('!a\nb', 4)).toBeNull();
		expect(getTrigger('hello\n!oci', 10)).toBeNull();
	});

	it('caret sensitivity: only text before the caret counts', () => {
		expect(getTrigger('!oci', 2)).toBe('!o');
	});

	it('bang NOT at position 0 → null (ordinary text, never a trigger)', () => {
		expect(getTrigger('a!w', 3)).toBeNull();
		expect(getTrigger('wow!', 4)).toBeNull();
	});

	it('spaces allowed — multi-keyword bang queries work', () => {
		expect(getTrigger('!new code', 9)).toBe('!new code');
	});
	});

	describe('triggerMode / TRIGGER_CHARS (D1)', () => {
		it('TRIGGER_CHARS is exactly ["?", "!"]', () => {
			expect([...TRIGGER_CHARS]).toEqual(['?', '!']);
		});

		it('"?" → find, "!" → run (the first char decides)', () => {
			expect(triggerMode('?load')).toBe('find');
			expect(triggerMode('!oci')).toBe('run');
		});

		it('a non-trigger string answers find (callers gate on getTrigger)', () => {
			expect(triggerMode('load')).toBe('find');
			expect(triggerMode('')).toBe('find');
		});
	});

	describe('searchKey strips the bang like the question mark', () => {
		it('"!oci" → "oci"', () => {
			expect(searchKey('!oci')).toBe('oci');
			expect(searchKey('!')).toBe('');
		});
	});
});

describe('searchKey', () => {
	it('strips the trigger char', () => {
		expect(searchKey('?load')).toBe('load');
		expect(searchKey('?')).toBe('');
	});
});

describe('splitKey — ";"/whitespace AND semantics (ADR §4)', () => {
	it('splits on ";": load;skill;feature-spec → 3 terms', () => {
		expect(splitKey('load;skill;feature-spec')).toEqual(['load', 'skill', 'feature-spec']);
	});

	it('splits on whitespace too, mixed separators collapse', () => {
		expect(splitKey('load skill')).toEqual(['load', 'skill']);
		expect(splitKey(' load ;\t skill \n ')).toEqual(['load', 'skill']);
	});

	it('stray empties dropped', () => {
		expect(splitKey('load;;skill;')).toEqual(['load', 'skill']);
	});

	it('dedupes case-insensitively, first spelling wins', () => {
		expect(splitKey('Load;load;SKILL;skill')).toEqual(['Load', 'SKILL']);
	});

	it('single-term passthrough; empty → []', () => {
		expect(splitKey('single-term')).toEqual(['single-term']);
		expect(splitKey('')).toEqual([]);
		expect(splitKey(';;;')).toEqual([]);
	});
});

describe('previewOf / textPreviewOf (ADR D8)', () => {
	it('previewOf prefers the label, first non-empty line', () => {
		expect(previewOf(row({ label: 'short', text: 'first\nsecond' }))).toBe('short');
		expect(previewOf(row({ text: 'first\nsecond' }))).toBe('first');
		expect(previewOf(row({ text: '\n\nsecond line' }))).toBe('second line');
	});

	it('textPreviewOf never consults the label', () => {
		expect(textPreviewOf(row({ label: 'short', text: 'first\nsecond' }))).toBe('first');
	});
});

describe('previewSegments — contains highlight (F4/S4)', () => {
	it('contains hit mid-label → label previews with hit segment split', () => {
		const segs = previewSegments(row({ label: 'skill-loader', text: 'first\nline two' }), '?load');
		expect(segs).toEqual([
			{ text: 'skill-', hit: false },
			{ text: 'load', hit: true },
			{ text: 'er', hit: false }
		]);
	});

	it('hit on line 3 of multiline → previews line 3, not line 1', () => {
		const segs = previewSegments(
			row({ text: 'line one\nline two\nmy name is widiharsojo' }),
			'?widi'
		);
		expect(segs).toEqual([
			{ text: 'my name is ', hit: false },
			{ text: 'widi', hit: true },
			{ text: 'harsojo', hit: false }
		]);
		const flat = segs.map((s) => s.text).join('');
		expect(flat).not.toContain('line one');
	});

	it('label present but hit only in text → text line previews', () => {
		const segs = previewSegments(
			row({ label: 'report', text: 'first line\ngive me the overnight summary' }),
			'?overnight'
		);
		expect(segs).toEqual([
			{ text: 'give me the ', hit: false },
			{ text: 'overnight', hit: true },
			{ text: ' summary', hit: false }
		]);
	});

	it('multi-term AND: every term marked, first line containing all terms wins', () => {
		const segs = previewSegments(
			row({ text: 'load project AIP\nskill file load feature' }),
			'?load;skill'
		);
		const flat = segs.map((s) => s.text).join('');
		expect(flat).toBe('skill file load feature');
		expect(segs.filter((s) => s.hit).map((s) => s.text).sort()).toEqual(['load', 'skill']);
	});

	it('overlapping term spans: longest first, shorter overlap dropped', () => {
		// "load" contains "oad" — the longer term's span wins
		const segs = previewSegments(row({ text: 'load project' }), '?load;oad');
		expect(segs).toEqual([{ text: 'load', hit: true }, { text: ' project', hit: false }]);
	});

	it('long line renders whole with its hit marked (full-width rows, no window)', () => {
		const line = 'a'.repeat(40) + 'widi' + 'b'.repeat(76); // 120 chars
		const segs = previewSegments(row({ text: line }), '?widi');
		const hit = segs.find((s) => s.hit)!;
		expect(hit.text).toBe('widi');
		expect(segs.map((s) => s.text).join('')).toBe(line);
	});

	it('no query / not a "?" query → single plain segment', () => {
		const r = row({ text: 'my name is widiharsojo' });
		expect(previewSegments(r, '')).toEqual([{ text: 'my name is widiharsojo', hit: false }]);
		expect(previewSegments(r, '.widi')).toEqual([{ text: 'my name is widiharsojo', hit: false }]);
	});

	it('empty key ("?" alone) returns plain preview', () => {
		const r = row({ text: 'anything' });
		expect(previewSegments(r, '?')).toEqual([{ text: 'anything', hit: false }]);
	});
});

describe('previewSegments — fuzzy word highlight (F4 tier 2)', () => {
	it('contains miss → best word ≥0.5 highlighted: "lod" → "load" 0.75', () => {
		const segs = previewSegments(row({ text: 'load the skill file' }), '?lod');
		expect(segs).toEqual([
			{ text: 'load', hit: true },
			{ text: ' the skill file', hit: false }
		]);
	});

	it('weak word below 0.5 floor stays plain', () => {
		const r = row({ text: 'board the ship' });
		expect(previewSegments(r, '?lod')).toEqual([{ text: 'board the ship', hit: false }]);
	});

	it('key longer than any word → plain preview, no crash', () => {
		const r = row({ text: 'xy' });
		expect(previewSegments(r, '?xxxxxxxxxxxx')).toEqual([{ text: 'xy', hit: false }]);
	});
});

describe('similarity math (parity pins)', () => {
	it('identical → 1; disjoint → 0; sub-3-char → 0', () => {
		expect(diceSimilarity('widi', 'widi')).toBe(1);
		expect(diceSimilarity('aaaa', 'zzzz')).toBe(0);
		expect(diceSimilarity('ab', 'ab')).toBe(0);
		expect(diceSimilarity('', 'widiharsojo')).toBe(0);
	});

	it('multiset trigram counts: aaaa vs aaa → 2/3', () => {
		expect(diceSimilarity('aaaa', 'aaa')).toBeCloseTo(2 / 3, 5);
	});

	it('FUZZY_MIN_LEN is 4 (server parity)', () => {
		expect(FUZZY_MIN_LEN).toBe(4);
	});
});

describe('splitKey parity — client mirrors server splitQueryTerms (S1)', () => {
	it('same S1 table both sides (raw forms)', async () => {
		const { splitQueryTerms } = await import('$lib/server/prompts/db.js');
		const vectors = [
			'load;skill;feature-spec',
			' load ;\t skill \n ',
			'load;;skill;',
			'Load;load;SKILL;skill',
			';;;',
			'',
			'single'
		];
		for (const v of vectors) {
			const client = splitKey(v);
			const server = splitQueryTerms(v).map((t: { raw: string }) => t.raw);
			expect(client).toEqual(server);
		}
	});
});
