/**
 * a2a-matcher tests (Task 2.2-T) — the pure tier contract.
 * Import-free module; runs under happy-dom like the rest of the unit
 * layer (no node-env glob needed — nothing imports node:sqlite here).
 *
 * Spec: dev/specs/2026-08-25 - DSI a2a Signature and Delegation Ledger
 *      (PRD "Tier contract"; Tasks 2.2/2.2-T).
 */

import { describe, expect, it } from 'vitest';
import { classifyReply } from '$lib/server/a2a/matcher.js';

const ID = 'a2a-0123456789abcdef';

describe('classifyReply — tier contract (ADR §4)', () => {
	it('Trial-B reply (instructed echo) → exact', () => {
		expect(classifyReply(`All tests passed.\n_a2a_:${ID};`, ID)).toBe('exact');
	});

	it('Trial-A reply (bare id, no marker) → none — strict: watermark-approx, never faux-attribution', () => {
		expect(classifyReply(`Done. ${ID}`, ID)).toBe('none');
		expect(classifyReply(`Done, ref ${ID} attached.`, ID)).toBe('none');
	});

	it('whitespace around the suffix → exact after trim', () => {
		expect(classifyReply(`done _a2a_:${ID};   \n\t`, ID)).toBe('exact');
	});

	it('code-fence suffix after the signature → exact (fenced echo)', () => {
		expect(classifyReply(`done\n\`\`\`\n_a2a_:${ID};\n\`\`\``, ID)).toBe('exact');
		expect(classifyReply(`done\n\`\`\`\n_a2a_:${ID};\n\`\`\`\n`, ID)).toBe('exact');
	});

	it('marker present but id different → none', () => {
		expect(classifyReply('done _a2a_:a2a-ffffffffffffffff;', ID)).toBe('none');
	});

	it('case variants — marker and id case-tolerant', () => {
		expect(classifyReply(`done _A2A_:${ID.toUpperCase()};`, ID)).toBe('exact');
		expect(classifyReply(`DONE _a2a_:${ID.toUpperCase()} mid-text`, ID)).toBe('attributed');
	});

	it('signature mid-text only (not terminal) → attributed', () => {
		expect(classifyReply(`Started _a2a_:${ID}; then continued`, ID)).toBe('attributed');
	});

	it('empty / no signature at all → none', () => {
		expect(classifyReply('', ID)).toBe('none');
		expect(classifyReply('all done, no mention of anything', ID)).toBe('none');
	});
});
