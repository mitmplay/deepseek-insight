/**
 * todo-lists unit tests — the TodoCard parser (ADR-0009): args →
 * {items}, the content-keyed snapshot diff against the epoch-1
 * progression observed in session 2758c928, junk honesty, and the
 * peek one-liner.
 */

import { describe, expect, it } from 'vitest';
import { diffTodoLists, isTodoTool, parseTodoList, todoListPreview } from '$lib/utils/todo-lists';

/** Wire-shaped args builder. */
function twArgs(statuses: string[]): string {
	const items = ['Create stick-to-bottom primitive', 'Expose scroller', 'Apply to think popup', 'Refactor scroll area', 'Tests', 'Verify'].map((content, i) => ({ content, status: statuses[i] }));
	return JSON.stringify({ todos: items });
}

describe('isTodoTool', () => {
	it('matches exactly the wire name', () => {
		expect(isTodoTool('todo_write')).toBe(true);
		expect(isTodoTool('bash')).toBe(false);
	});
});

describe('parseTodoList', () => {
	it('parses a valid snapshot in wire order', () => {
		const list = parseTodoList(twArgs(['in_progress', 'pending', 'pending', 'pending', 'pending', 'pending']));
		expect(list?.items).toHaveLength(6);
		expect(list?.items[0]).toEqual({ content: 'Create stick-to-bottom primitive', status: 'in_progress' });
	});

	it('junk, missing todos, invalid status, empty list → undefined', () => {
		expect(parseTodoList(undefined)).toBeUndefined();
		expect(parseTodoList('{not json')).toBeUndefined();
		expect(parseTodoList('{}')).toBeUndefined();
		expect(parseTodoList('{"todos":[{"content":"x","status":"weird"}]}')).toBeUndefined();
		expect(parseTodoList('{"todos":[]}')).toBeUndefined();
		expect(parseTodoList('{"todos":"nope"}')).toBeUndefined();
	});
});

describe('diffTodoLists — the epoch-1 progression (ippppp → ccippp → cccipp → ccccci)', () => {
	it('each call marks one just-completed and one now-active', () => {
		const s1 = parseTodoList(twArgs(['in_progress', 'pending', 'pending', 'pending', 'pending', 'pending']))!;
		const s2 = parseTodoList(twArgs(['completed', 'completed', 'in_progress', 'pending', 'pending', 'pending']))!;
		const d2 = diffTodoLists(s1, s2);
		expect(d2?.get('Create stick-to-bottom primitive')).toEqual({ kind: 'just-completed' });
		expect(d2?.get('Expose scroller')).toEqual({ kind: 'just-completed' });
		expect(d2?.get('Apply to think popup')).toEqual({ kind: 'now-active' });
	});

	it('same texts, different order still diff by content', () => {
		const a = parseTodoList(twArgs(['in_progress', 'pending', 'pending', 'pending', 'pending', 'pending']))!;
		// Reversed order, statuses rewritten: item 6 (was pending) now
		// in_progress; item 1 (was in_progress) now completed — pairing
		// must follow CONTENT across the reorder, not position.
		const reordered = [...a.items].reverse().map((i, ix) => ({ ...i, status: ix === 0 ? 'in_progress' : ix === 5 ? 'completed' : 'pending' }));
		const d = diffTodoLists(a, parseTodoList(JSON.stringify({ todos: reordered }))!);
		expect(d?.get('Verify')).toEqual({ kind: 'now-active' }); // last item, now first, now active
		expect(d?.get('Create stick-to-bottom primitive')).toEqual({ kind: 'just-completed' });
	});

	it('a rewritten text set reads as NEW (undefined), never a fake delta', () => {
		const a = parseTodoList(twArgs(['in_progress', 'pending', 'pending', 'pending', 'pending', 'pending']))!;
		const b = parseTodoList(JSON.stringify({ todos: [{ content: 'Different plan', status: 'pending' }] }))!;
		expect(diffTodoLists(a, b)).toBeUndefined();
	});
});

describe('todoListPreview — the peek one-liner', () => {
	it('progress plus the active item, never item one on every row', () => {
		const s3 = twArgs(['completed', 'completed', 'completed', 'in_progress', 'pending', 'pending']);
		expect(todoListPreview(s3)).toBe('3/6 · Refactor scroll area');
	});

	it('no active item → the bare ratio', () => {
		expect(todoListPreview(twArgs(['completed', 'completed', 'completed', 'completed', 'completed', 'completed']))).toBe('6/6');
	});

	it('caps at 120 with ellipsis; junk → empty', () => {
		const long = 'x'.repeat(200);
		const args = JSON.stringify({ todos: [{ content: long, status: 'in_progress' }] });
		const line = '0/1 · ' + long;
		expect(todoListPreview(args)).toBe(line.slice(0, 119) + '…');
		expect(todoListPreview('{not json')).toBe('');
	});
});
