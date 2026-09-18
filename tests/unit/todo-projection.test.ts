/**
 * todo-projection unit tests — the host's `todos` projection value →
 * the Current Plan readout (three-state read: undefined = not delivered,
 * null = no plan, array = validated items). Wire shape pinned from DSH
 * packages/todo/tool-todo/src/index.ts (todosProjectionSchema:
 * TodoItem[] | null; item = {content: string, status: pending|in_progress|completed}).
 */
import { describe, expect, it } from 'vitest';
import { todosFromProjection } from '../../src/lib/services/conversation/todo-projection';

const item = { content: 'load the folders', status: 'in_progress' } as const;

describe('todosFromProjection', () => {
	it('undefined input → undefined (key not delivered — caller keeps current)', () => {
		expect(todosFromProjection(undefined)).toBeUndefined();
	});

	it('null → null (the host cleared the plan)', () => {
		expect(todosFromProjection(null)).toBeNull();
	});

	it('valid items pass through', () => {
		const raw = [
			{ content: 'a', status: 'completed' },
			{ content: 'b', status: 'in_progress' },
			{ content: 'c', status: 'pending' }
		];
		expect(todosFromProjection(raw)).toEqual([
			{ content: 'a', status: 'completed' },
			{ content: 'b', status: 'in_progress' },
			{ content: 'c', status: 'pending' }
		]);
	});

	it('malformed items drop; empty content / unknown status skipped', () => {
		const raw = [
			{ content: 'keep', status: 'pending' },
			{ content: '', status: 'pending' },
			{ content: 'no status' },
			{ content: 'bad status', status: 'done' },
			null,
			'junk'
		];
		expect(todosFromProjection(raw)).toEqual([{ content: 'keep', status: 'pending' }]);
	});

	it('an array that validates to nothing reads as null (never a zero-task plan)', () => {
		expect(todosFromProjection([{ nope: true }])).toBeNull();
		expect(todosFromProjection([])).toBeNull();
	});

	it('a non-array non-null value reads as null (broken contract, not a plan)', () => {
		expect(todosFromProjection({ content: 'x', status: 'pending' })).toBeNull();
		expect(todosFromProjection('pending')).toBeNull();
	});
});
