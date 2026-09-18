/**
 * ConversationScrollArea unit tests — the transcript viewport block,
 * driven through the ScrollAreaHost fixture (mount-time props are
 * one-shot; the host exports setters so growth/prepend and card state
 * can change after mount — the ControlBarHarness pattern).
 *
 * Covers: group rendering (prompt + context + assistant runs), the
 * context-injection popups on BOTH group shapes, the answerer card
 * sections (pending above settled, body-coercion fallbacks, onanswer
 * payloads), and the two scroll behaviors the block owns — stick-to-
 * bottom (break on scroll-up, re-engage at bottom) and prepend
 * anchoring (scrollTop compensation while reading history).
 *
 * happy-dom has no layout: viewport geometry is faked with getters
 * tied to the rendered DOM (100px per group), which is exactly the
 * pre/post split $effect.pre and $effect see around a DOM update.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScrollAreaHost from '../fixtures/ScrollAreaHost.svelte';
import type { DsiEntry } from '$lib/types';
import type { AnswerView } from '$lib/services/conversation/store.svelte';

const T = 1_700_000_000_000;

const user = (
	id: string,
	text: string,
	meta?:
		| 'runtime-context'
		| 'instructions'
		| 'skill-catalog'
		| 'skill-invocation'
		| 'compaction'
		| 'plugin'
		| 'recall'
		| 'injected'
): DsiEntry => ({
	kind: 'user-message',
	id,
	seq: Number(id.replace(/\D/g, '')) || 1,
	time: T,
	text,
	...(meta ? { meta, metaSource: {} } : {})
});

const assistant = (id: string, text: string): DsiEntry => ({
	kind: 'assistant-message',
	id,
	seq: 2,
	time: T,
	text,
	streaming: false
});

const call = (id: string): DsiEntry => ({
	kind: 'tool-call',
	id,
	seq: 3,
	time: T,
	callId: `call-${id}`,
	toolName: 'bash',
	status: 'pass',
	argsRaw: '{"command":"ls"}'
});

type Host = {
	setEntries: (e: DsiEntry[]) => void;
	setOpenChipId: (id: string | null) => void;
	setPeekRunKey: (k: string | null) => void;
	setHasMore: (v: boolean | undefined) => void;
	setCards: (p: AnswerView[], s?: AnswerView[]) => void;
	answerLog: () => Array<{ rpcId: string; payload: Record<string, unknown> }>;
	loadLog: () => number[];
	chipLog: () => string[];
	peekLog: () => string[];
};

function renderHost(): { target: HTMLElement; host: Host; viewport: HTMLElement; unmount: () => void } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ScrollAreaHost, { target });
	const host = instance as unknown as Host;
	const viewport = target.querySelector('[data-testid="transcript"]') as HTMLElement;
	return { target, host, viewport, unmount: () => unmount(instance) };
}

/** Fake geometry: content height grows with rendered groups (100px each). */
function fakeGeometry(viewport: HTMLElement): void {
	Object.defineProperty(viewport, 'scrollHeight', {
		configurable: true,
		get: () => Math.max(1, viewport.querySelectorAll('[data-group-key]').length) * 100
	});
	Object.defineProperty(viewport, 'clientHeight', { configurable: true, get: () => 50 });
}

async function settle(rounds = 8): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

/** Scroll position → stick decision helper (NEAR_BOTTOM_PX = 48). */
function scrollTo(viewport: HTMLElement, top: number): void {
	viewport.scrollTop = top;
	viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
	flushSync();
}

describe('ConversationScrollArea — group rendering', () => {
	let r: ReturnType<typeof renderHost>;
	beforeEach(() => {
		r = renderHost();
	});
	afterEach(() => {
		r.unmount();
	});

	it('empty entries render the empty state; sentinel hides without older pages', async () => {
		r.host.setEntries([]);
		await settle();
		expect(r.target.querySelector('[data-testid="transcript-empty"]')).not.toBeNull();
		expect(r.target.querySelector('[data-testid="load-older-button"]')).toBeNull();
	});

	it('hasMore surfaces the load-older button; clicking fires onloadolder', async () => {
		r.host.setEntries([user('u1', 'hi')]);
		r.host.setHasMore(true);
		await settle();
		(r.target.querySelector('[data-testid="load-older-button"]') as HTMLElement).click();
		expect(r.host.loadLog()).toHaveLength(1);
	});

	it('renders prompt, merged-context, and assistant groups with stable keys', async () => {
		// u2 (meta) follows the PROMPT u1 → merges into it; a1+c1 form ONE
		// assistant turn (groupTurns contract: consecutive assistant-side
		// entries accumulate into a single turn group).
		r.host.setEntries([
			user('u1', 'do the thing'),
			{ ...user('u2', 'runtime snapshot', 'runtime-context') },
			assistant('a1', 'working on **it**'),
			call('c1')
		]);
		await settle();
		const keys = [...r.target.querySelectorAll('[data-group-key]')].map((e) => e.getAttribute('data-group-key'));
		expect(keys).toEqual(['u1', 'a1']);
		expect(r.target.querySelector('[data-testid="message-bubble"]')?.textContent).toContain('do the thing');
		expect(r.target.querySelectorAll('[data-testid="context-injection-chip"]')).toHaveLength(1);
		expect(r.target.querySelector('.md-content strong')?.textContent).toBe('it');
		expect(r.target.querySelector('[data-testid="tool-chip-toggle"]')).not.toBeNull();
	});

	it('a context injection AFTER a turn JOINS that turn as a chip (The Turn Kept Whole, D1)', async () => {
		r.host.setEntries([user('u1', 'hi'), assistant('a1', 'answer'), { ...user('u2', 'late ctx', 'skill-catalog') }]);
		await settle();
		// No separate context bubble: the wire turn stays whole, the chip
		// rides inside the turn group at its wire position.
		const keys = [...r.target.querySelectorAll('[data-group-key]')].map((e) => e.getAttribute('data-group-key'));
		expect(keys).toEqual(['u1', 'a1']);
		const turn = r.target.querySelector('[data-group-key="a1"]');
		expect(turn?.querySelector('[data-testid="context-injection-chip"]')).not.toBeNull();
	});

	it('context chips fire ontogglechip; an open chip renders the body as markdown prose (both group shapes)', async () => {
		// Prompt-merged context injection
		r.host.setEntries([user('u1', 'hi'), { ...user('u2', 'injected AFTER a turn', 'instructions') }]);
		// NOTE: a context entry after a turn JOINS that turn (D1); to get the
		// standalone shape the context must open the session (D4 keeps that
		// branch for injections with no turn or prompt behind them).
		r.host.setEntries([
			{ ...user('u2', 'standalone **context** body', 'skill-catalog') },
			user('u1', 'hi'),
			assistant('a1', 'answer')
		]);
		await settle();
		const chip = r.target.querySelector('[data-testid="context-injection-toggle"]') as HTMLElement;
		chip.click();
		expect(r.host.chipLog()).toEqual(['u2']);
		r.host.setOpenChipId('u2');
		await settle();
		const body = r.target.querySelector('[data-testid="context-injection-body"]');
		expect(body?.textContent).toContain('standalone context body');
		// Markdown prose, ToolCallDetail parity — **context** renders <strong>.
		expect(body?.querySelector('.md-content strong')?.textContent).toBe('context');
	});

	it('prompt-merged context opens its popup inside the bubble', async () => {
		r.host.setEntries([user('u1', 'hi'), { ...user('u2', 'merged **context** body', 'runtime-context') }]);
		await settle();
		r.host.setOpenChipId('u2');
		await settle();
		const body = r.target.querySelector('[data-testid="context-injection-body"]');
		expect(body).not.toBeNull();
		expect(body?.textContent).toContain('merged context body');
		expect(body?.querySelector('.md-content strong')?.textContent).toBe('context');
	});

	it('tool runs wire peek toggles with the run key', async () => {
		r.host.setEntries([call('c1')]);
		await settle();
		(r.target.querySelector('[data-testid="tool-peek-button"]') as HTMLElement).click();
		expect(r.host.peekLog()).toHaveLength(1);
	});
});

describe('ConversationScrollArea — answerer cards', () => {
	let r: ReturnType<typeof renderHost>;
	beforeEach(() => {
		r = renderHost();
	});
	afterEach(() => {
		r.unmount();
	});

	const approval = (over: Partial<AnswerView> = {}): AnswerView => ({
		rpcId: 'rpc-a1',
		sessionId: 'sess-test',
		kind: 'approval',
		body: { approvalId: 'apr-1', toolName: 'Write', callId: 'call-9', reason: 'writes outside the workspace' },
		receivedAt: T,
		phase: 'waiting',
		...over
	});

	const question = (over: Partial<AnswerView> = {}): AnswerView => ({
		rpcId: 'rpc-q1',
		sessionId: 'sess-test',
		kind: 'question',
		body: { questions: [{ id: 'q1', question: 'Ship it?', options: [{ id: 'o1', label: 'Yes' }] }] },
		receivedAt: T,
		phase: 'waiting',
		...over
	});

	it('pending approval renders its card; answering routes rpcId + outcome', async () => {
		r.host.setCards([approval()]);
		await settle();
		expect(r.target.querySelector('[data-testid="answerer-pending"]')).not.toBeNull();
		expect(r.target.querySelector('[data-testid="approval-card"]')).not.toBeNull();
		expect(r.target.querySelector('[data-testid="approval-tool"]')?.textContent).toContain('Write');
		expect(r.target.querySelector('[data-testid="approval-reason"]')?.textContent).toContain('writes outside');
		// approve → payload {approvalId, outcome}
		(r.target.querySelector('[data-testid="approval-allow"]') as HTMLElement).click();
		await settle();
		const entry = r.host.answerLog().at(-1);
		expect(entry?.rpcId).toBe('rpc-a1');
		expect(entry?.payload).toMatchObject({ approvalId: 'apr-1', outcome: 'allowed-once' });
	});

	it('junk approval body falls back honestly: empty approvalId, "unknown tool", no reason', async () => {
		r.host.setCards([approval({ body: { approvalId: 42, toolName: null, reason: '' } })]);
		await settle();
		expect(r.target.querySelector('[data-testid="approval-tool"]')?.textContent).toContain('unknown tool');
		expect(r.target.querySelector('[data-testid="approval-reason"]')).toBeNull(); // empty reason → pane hidden
		// The card still answers with the (non-string) id passed through.
		(r.target.querySelector('[data-testid="approval-allow"]') as HTMLElement).click();
		await settle();
		expect(r.host.answerLog().at(-1)?.payload).toMatchObject({ approvalId: 42 });
	});

	it('pending question renders parsed questions; answering carries the session id', async () => {
		r.host.setCards([question()]);
		await settle();
		expect(r.target.querySelector('[data-testid="question-text"]')?.textContent).toContain('Ship it?');
		// Pick the option first — submit stays disabled until every question
		// has an answer (QuestionCard invalid-state contract).
		(r.target.querySelector('[data-testid="question-option"]') as HTMLElement).click();
		await settle();
		(r.target.querySelector('[data-testid="question-submit"]') as HTMLElement).click();
		await settle();
		const entry = r.host.answerLog().at(-1);
		expect(entry?.rpcId).toBe('rpc-q1');
		expect(entry?.payload).toHaveProperty('answer');
	});

	it('settled cards render read-only (no onanswer wiring surfaces)', async () => {
		r.host.setCards(
			[],
			[
				approval({ phase: 'settled', outcome: 'allowed-once' }),
				question({ phase: 'answered-elsewhere' })
			]
		);
		await settle();
		expect(r.target.querySelector('[data-testid="answerer-settled"]')).not.toBeNull();
		expect(r.target.querySelector('[data-testid="answerer-pending"]')).toBeNull();
		expect(r.host.answerLog()).toEqual([]);
		// settled approval: resolved line, no Allow/Reject; settled question: elsewhere line, no submit
		expect(r.target.querySelector('[data-testid="approval-settled"]')?.textContent).toContain('resolved');
		expect(r.target.querySelector('[data-testid="approval-allow"]')).toBeNull();
		expect(r.target.querySelector('[data-testid="question-elsewhere"]')).not.toBeNull();
		expect(r.target.querySelector('[data-testid="question-submit"]')).toBeNull();
	});
});

describe('ConversationScrollArea — scroll-stick', () => {
	let r: ReturnType<typeof renderHost>;
	beforeEach(() => {
		r = renderHost();
		fakeGeometry(r.viewport);
	});
	afterEach(() => {
		r.unmount();
	});

	it('mounts stuck to the bottom; appended entries keep the pin', async () => {
		// user+assistant alternate → one GROUP per entry (consecutive
		// assistant-side entries would merge into one turn — the geometry
		// model is 100px per group).
		r.host.setEntries([user('u1', 'one'), assistant('a1', 'two')]);
		await settle();
		expect(r.viewport.scrollTop).toBe(200); // 2 groups × 100
		r.host.setEntries([user('u1', 'one'), assistant('a1', 'two'), user('u2', 'three')]);
		await settle();
		expect(r.viewport.scrollTop).toBe(300); // still glued to the latest
	});

	it('scrolling up breaks the stick — a later append does NOT yank back', async () => {
		r.host.setEntries([user('u1', 'one'), assistant('a1', 'two')]);
		await settle();
		scrollTo(r.viewport, 50); // 50 + 50 < 200 - 48 → off-bottom
		r.host.setEntries([user('u1', 'one'), assistant('a1', 'two'), user('u2', 'three')]);
		await settle();
		expect(r.viewport.scrollTop).toBe(50); // reading position honored
	});

	it('scrolling back to the bottom re-engages the stick', async () => {
		r.host.setEntries([user('u1', 'one'), assistant('a1', 'two')]);
		await settle();
		scrollTo(r.viewport, 50);
		scrollTo(r.viewport, 200); // 200 + 50 >= 200 - 48 → bottom again
		r.host.setEntries([user('u1', 'one'), assistant('a1', 'two'), user('u2', 'three')]);
		await settle();
		expect(r.viewport.scrollTop).toBe(300);
	});
});

describe('ConversationScrollArea — prepend anchoring (auto load-older)', () => {
	let r: ReturnType<typeof renderHost>;
	beforeEach(() => {
		r = renderHost();
		fakeGeometry(r.viewport);
	});
	afterEach(() => {
		r.unmount();
	});

	it('a prepend while reading history compensates scrollTop (Δheight)', async () => {
		// [u1, a1, c1] → prompt(u1) + turn(a1,c1) = 2 groups = 200px
		r.host.setEntries([user('u1', 'one'), assistant('a1', 'two'), call('c1')]);
		await settle();
		expect(r.viewport.scrollTop).toBe(200); // stuck at bottom
		scrollTo(r.viewport, 100); // 100 + 50 < 200 - 48 → user reads history
		// An older page PREPENDS: [o1, o2] adds prompt(o1) + turn(o2) = 2 groups
		r.host.setEntries([
			user('o1', 'old one'),
			assistant('o2', 'old two'),
			user('u1', 'one'),
			assistant('a1', 'two'),
			call('c1')
		]);
		await settle();
		// pre: height 200, top 100 → post: top = 400 - 200 + 100 = 300
		expect(r.viewport.scrollTop).toBe(300);
	});

	it('a prepend while stuck stays glued to the bottom (stick wins)', async () => {
		r.host.setEntries([user('u1', 'one'), assistant('a1', 'two')]);
		await settle();
		r.host.setEntries([user('o1', 'old'), user('u1', 'one'), assistant('a1', 'two')]);
		await settle();
		expect(r.viewport.scrollTop).toBe(300); // bottom of the grown content
	});
});
