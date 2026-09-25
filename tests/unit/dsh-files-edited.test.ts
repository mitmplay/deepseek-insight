/**
 * dsh-files-edited unit tests — the workspace/changes wire mapping
 * (Edited-Files Card, task 1.1-T; ADR 2026-09-25 D1/D3).
 *
 * Wire fact: the event payload is { turn: number } ONLY — the summary
 * stays in Host memory (packages/deliverables/workspace-changes/src/
 * types.ts:100-107). Tests use the live shape, not invented ones.
 */
import { describe, expect, it } from 'vitest';
import { entryForEvent, mergeEntries, type DshRawEvent } from '$lib/services/conversation/dsh-events';

function changesEvent(seq: number, turn: unknown, time = 1787252720796): DshRawEvent {
	return {
		type: 'workspace/changes',
		seq,
		time,
		data: { turn } as Record<string, unknown>
	};
}

describe('workspace/changes → files-edited entry (task 1.1-T)', () => {
	it('folds a numeric-turn event to one fe:<turn> pointer', () => {
		const entry = entryForEvent(changesEvent(41, 7));
		expect(entry).toMatchObject({ kind: 'files-edited', id: 'fe:7', seq: 41, turn: 7, time: 1787252720796 });
	});

	it('tolerates a non-numeric turn: still folds, as the fe:unknown pointer', () => {
		const missing = entryForEvent(changesEvent(42, undefined));
		expect(missing).toMatchObject({ kind: 'files-edited', id: 'fe:unknown', seq: 42, turn: 0 });
		const garbage = entryForEvent(changesEvent(43, 'seven'));
		expect(garbage).toMatchObject({ kind: 'files-edited', id: 'fe:unknown', seq: 43, turn: 0 });
	});

	it('a same-turn re-announce REPLACES at merge — never stacks (D3)', () => {
		const first = entryForEvent(changesEvent(41, 7, 1000))!;
		const second = entryForEvent(changesEvent(58, 7, 2000))!;
		const merged = mergeEntries([first], [second]);
		expect(merged.filter((e) => e.kind === 'files-edited')).toHaveLength(1);
		expect(merged[0]).toMatchObject({ id: 'fe:7', seq: 58, time: 2000 });
	});

	it('a stale re-announce (older seq) does not win', () => {
		const newer = entryForEvent(changesEvent(58, 7, 2000))!;
		const older = entryForEvent(changesEvent(41, 7, 1000))!;
		const merged = mergeEntries([newer], [older]);
		expect(merged.filter((e) => e.kind === 'files-edited')).toHaveLength(1);
		expect(merged[0]).toMatchObject({ seq: 58 });
	});

	it('different turns are different entries, both kept', () => {
		const t7 = entryForEvent(changesEvent(41, 7))!;
		const t8 = entryForEvent(changesEvent(42, 8))!;
		const merged = mergeEntries([t7], [t8]);
		expect(merged.filter((e) => e.kind === 'files-edited')).toHaveLength(2);
	});

	it('neighbor entry order is untouched by the fold', () => {
		const userMessageEvent: DshRawEvent = {
			type: 'user/message',
			seq: 40,
			time: 1787252720790,
			data: { content: [{ type: 'text', text: 'Hi' }] }
		};
		const entries = mergeEntries(
			[entryForEvent(userMessageEvent)!, entryForEvent(changesEvent(41, 7))!],
			[entryForEvent(changesEvent(44, 7))!]
		);
		expect(entries.map((e) => e.seq)).toEqual([40, 44]);
		expect(entries[0]!.kind).toBe('user-message');
		expect(entries[1]!.kind).toBe('files-edited');
	});
});
