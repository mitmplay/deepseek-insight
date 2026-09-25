/**
 * Transcript fold test (task 3.3-T, spec "2026-09-25 - Edited-Files Card")
 * — a files-edited entry in the render list mounts the FilesEditedCard
 * inside its turn row (InlineToolCalls branch), neighbors unaffected.
 * The session context is provided by the test host; fetch is stubbed.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InlineToolCallsHost from './InlineToolCallsHost.svelte';
import type { TurnMember } from '$lib/utils/turn-grouping';

const SUMMARY = {
	turn: 7,
	files: [{ path: 'src/a.ts', display: 'src/a.ts', added: 4, deleted: 1 }],
	total: 1,
	added: 4,
	deleted: 1
};

const entries: TurnMember[] = [
	{
		kind: 'tool-call',
		id: 'call:1',
		seq: 30,
		time: 1787252720000,
		callId: 'call-1',
		toolName: 'bash',
		status: 'pass'
	},
	{ kind: 'files-edited', id: 'fe:7', seq: 41, time: 1787252790000, turn: 7 },
	{
		kind: 'unknown-event',
		id: 'ev:50',
		seq: 50,
		time: 1787252800000,
		eventType: 'team/member'
	}
];

describe('files-edited entry renders the card in its turn (task 3.3-T)', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Response(JSON.stringify({ ok: true, summary: SUMMARY }), { status: 200 }))
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	});

	it('peek button stays hidden when files-edited is the only non-assistant entry', async () => {
		const target = document.body.appendChild(document.createElement('div'));
		const comp = mount(InlineToolCallsHost, {
			target,
			props: { sessionId: 'session-1', entries: [{ kind: 'files-edited', id: 'fe:7', seq: 41, time: 1, turn: 7 }] }
		});
		flushSync();
		// the card IS the row content — a peek button claiming a tool call
		// that is not there is the 2026-09-25 bug, never again.
		expect(target.querySelector('[data-testid="tool-peek-button"]')).toBeNull();
		expect(target.querySelector('[data-testid="files-edited-toggle"]')).not.toBeNull();
		unmount(comp);
		target.remove();
	});

	it('mounts the card between neighbors; the neighbors render as before', async () => {
		const target = document.body.appendChild(document.createElement('div'));
		const comp = mount(InlineToolCallsHost, {
			target,
			props: { sessionId: 'session-1', entries }
		});
		flushSync();
		// chip-default contract: expand before the body exists
		(target.querySelector('[data-testid="files-edited-toggle"]') as HTMLElement).click();
		flushSync();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="files-edited-card"]')).not.toBeNull();
		});
		const card = target.querySelector('[data-testid="files-edited-card"]')!;
		expect(card.textContent).toContain('src/a.ts');
		// neighbors untouched: the bash tool call chip + the unknown chip
		// (chipToolTitle renders the registry name title-cased — 'Bash')
		expect(target.textContent).toContain('Bash');
		expect(target.textContent).toContain('team/member');
		// Peek fix (2026-09-25): the files-edited entry is NOT a chip —
		// the peek button counts only real chips (2: bash + the event),
		// never the self-rendering card.
		const peek = target.querySelector('[data-testid="tool-peek-button"]')!;
		expect(peek.textContent).toContain('2');
		unmount(comp);
		target.remove();
	});
});
