/**
 * todo-projection — the host's CURRENT todo list, read from the
 * session/control projection stream (the permission-state seam: same
 * block, pure mapping — no I/O, no Svelte). The host folds the latest
 * todo_write into the `todos` projection and clears it on the next
 * turn/start (tool-todo/src/index.ts: "standing-plan fold"), so this
 * value is always the agent's current plan — fresher than any chip,
 * which only lands when the tool runs.
 *
 * Three-state read (mirrors the wire schema TodoItem[] | null):
 *   undefined — the projection key was never delivered (caller keeps
 *               whatever it already shows; absent ≠ empty)
 *   null      — the host says there is NO current plan (pre-first-write
 *               or the next turn began) — the caller clears
 *   array     — the standing plan, validated item by item
 */

import type { TodoItem } from '$lib/utils/todo-lists';

const STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed']);

/**
 * Validate the projections block's todos value.
 *
 * @param raw - the projection value (projections.values.todos), untyped.
 * @returns undefined when the key is absent (not delivered), null when the
 * host cleared the plan, else the validated items — a malformed ITEM drops
 * from the list; a list left empty that way reads as null (never a plan of
 * zero tasks).
 */
export function todosFromProjection(raw: unknown): TodoItem[] | null | undefined {
	if (raw === undefined) return undefined;
	if (raw === null) return null;
	if (!Array.isArray(raw)) return null;
	const items: TodoItem[] = [];
	for (const entry of raw) {
		if (entry === null || typeof entry !== 'object') continue;
		const o = entry as Record<string, unknown>;
		if (typeof o.content !== 'string' || o.content.length === 0) continue;
		if (typeof o.status !== 'string' || !STATUSES.has(o.status)) continue;
		items.push({ content: o.content, status: o.status as TodoItem['status'] });
	}
	return items.length > 0 ? items : null;
}
