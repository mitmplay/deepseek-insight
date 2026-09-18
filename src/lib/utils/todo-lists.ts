/**
 * todo_write payload parsing — the ONE parser for the TodoCard
 * (ADR-0009, 2026-08-26). The wire contract (DSH packages/todo:
 * whole-list replacement, harness-enforced invariants):
 *
 *   todos: [{content: string, status: 'pending'|'in_progress'|'completed'}]
 *
 * content is non-empty, trimmed, and UNIQUE within a list — the
 * invariant that makes content a safe diff key. Evidence (session
 * 2758c928): within one plan, item texts are byte-identical across
 * snapshots and only statuses migrate, exactly 2 flips per call.
 * The diff is display-derived annotation, never truth; junk parses
 * to undefined and the caller keeps the raw view. Never throws.
 */

/** Wire item status (tool-todo TODO_STATUSES). */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

/** One todo item, wire-verbatim. */
export interface TodoItem {
	content: string;
	status: TodoStatus;
}

/** A parsed todo_write snapshot. */
export interface TodoList {
	items: TodoItem[];
}

/** Per-item delta annotation vs the previous snapshot (display-only). */
export type TodoDelta =
	| { kind: 'just-completed' }
	| { kind: 'now-active' }
	| { kind: 'added' };

const STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed']);

/** True for the todo_write wire tool name (the card's one family). */
export function isTodoTool(toolName: string): boolean {
	return toolName === 'todo_write';
}

/**
 * Parse todo_write args; undefined when junk (no todos array or an
 * invalid item shape) — the caller renders the raw view then.
 */
export function parseTodoList(argsRaw: string | undefined): TodoList | undefined {
	if (argsRaw === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(argsRaw);
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
	const raw = (parsed as Record<string, unknown>).todos;
	if (!Array.isArray(raw)) return undefined;
	const items: TodoItem[] = [];
	for (const entry of raw) {
		if (entry === null || typeof entry !== 'object') return undefined;
		const o = entry as Record<string, unknown>;
		if (typeof o.content !== 'string' || typeof o.status !== 'string' || !STATUSES.has(o.status)) {
			return undefined;
		}
		items.push({ content: o.content, status: o.status as TodoStatus });
	}
	if (items.length === 0) return undefined;
	return { items };
}

/**
 * Diff one snapshot against its predecessor, keyed by content (the
 * harness uniqueness invariant makes it collision-free). A different
 * text set → undefined (a rewritten plan reads as NEW, not as a
 * delta — honest degradation per ADR-0009).
 */
export function diffTodoLists(prev: TodoList, next: TodoList): Map<string, TodoDelta> | undefined {
	const sameSet =
		prev.items.length === next.items.length &&
		prev.items.every((p) => next.items.some((n) => n.content === p.content));
	if (!sameSet) return undefined;
	const prevBy = new Map(prev.items.map((i) => [i.content, i.status]));
	const deltas = new Map<string, TodoDelta>();
	for (const item of next.items) {
		const was = prevBy.get(item.content);
		if (was === undefined) { deltas.set(item.content, { kind: 'added' }); continue; }
		if (was !== 'completed' && item.status === 'completed') deltas.set(item.content, { kind: 'just-completed' });
		else if (was !== 'in_progress' && item.status === 'in_progress') deltas.set(item.content, { kind: 'now-active' });
	}
	return deltas;
}

/**
 * Peek one-liner for a todo_write snapshot (ADR-0009):
 * '3/6 · <active item>' — progress plus where the model is, never
 * item one's text on every row. Empty when junk; the caller falls
 * back to the raw preview.
 */
export function todoListPreview(argsRaw: string | undefined): string {
	const list = parseTodoList(argsRaw);
	if (list === undefined) return '';
	const done = list.items.filter((i) => i.status === 'completed').length;
	const active = list.items.find((i) => i.status === 'in_progress');
	const head = done + '/' + list.items.length;
	if (active === undefined) return head;
	const line = head + ' · ' + active.content;
	return line.length > 120 ? line.slice(0, 119) + '…' : line;
}
