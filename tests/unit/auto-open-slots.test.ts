import { describe, it, expect } from 'vitest';
import { newestReasoningId, newestTodoToolId, suppressed } from '$lib/utils/auto-open-slots';

const think = (id: string) => ({ id, kind: 'assistant-message', reasoning: 'thinking…' });
const plain = (id: string) => ({ id, kind: 'assistant-message', reasoning: '' });
const todo = (id: string) => ({ id, kind: 'tool-call', toolName: 'todo_write' });
const other = (id: string) => ({ id, kind: 'tool-call', toolName: 'grep' });
const isTodoTool = (n: string) => n === 'todo_write';

describe('auto-open slot selection (ADR-0018 W3 task 3.2-T)', () => {
	it('newestReasoningId: wire order wins — last match, not first', () => {
		expect(newestReasoningId([think('r1'), plain('p'), think('r2')])).toBe('r2');
	});

	it('newestReasoningId: empty reasoning strings are not targets', () => {
		expect(newestReasoningId([plain('p1')])).toBeNull();
	});

	it('newestReasoningId: no candidates → null', () => {
		expect(newestReasoningId([other('g')])).toBeNull();
		expect(newestReasoningId([])).toBeNull();
	});

	it('newestTodoToolId: finds the latest todo_write among other tools', () => {
		expect(newestTodoToolId([todo('t1'), other('g1'), todo('t2')], isTodoTool)).toBe('t2');
	});

	it('newestTodoToolId: none → null', () => {
		expect(newestTodoToolId([other('g1')], isTodoTool)).toBeNull();
	});

	it('suppressed: the kept-collapsed id hides only ITSELF', () => {
		expect(suppressed('r1', 'r1')).toBeNull();
		expect(suppressed('r1', 'r0')).toBe('r1'); // a different collapsed id does not match
		expect(suppressed(null, 'r1')).toBeNull();
	});
});
