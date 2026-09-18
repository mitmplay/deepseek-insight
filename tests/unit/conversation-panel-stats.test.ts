/**
 * ConversationPanel stats-bar wiring (spec Wave 3, task 3.1-T): the bar
 * mounts OUTSIDE the subagent fence — above composer-area on agent
 * panels, as the bottom in-flow row on sub-agent panels (AC2/AC3, ADR
 * "The Stats Bar" D4) — and stays absent on an empty session (AC1).
 */
import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import StatsBarPanelHost from '../fixtures/StatsBarPanelHost.svelte';
import type { DsiEntry } from '../../src/lib/types';

function seed(): DsiEntry[] {
	return [
		{ kind: 'user-message', id: 'u1', seq: 1, time: 0, text: 'go' },
		{
			kind: 'assistant-message',
			id: 'a1',
			seq: 2,
			time: 0,
			text: 'done',
			streaming: false,
			usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900 }
		}
	];
}

function mountPanel(entries: DsiEntry[], subagent = false) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(StatsBarPanelHost, { target, props: { entries, subagent } as never });
	flushSync();
	return { target, instance, cleanup: () => { unmount(instance); target.remove(); } };
}

describe('ConversationPanel — stats bar wiring (D4)', () => {
	it('empty session renders no bar (AC1)', () => {
		const { target, cleanup } = mountPanel([]);
		expect(target.querySelector('[data-testid="conversation-stats-bar"]')).toBeNull();
		cleanup();
	});

	it('agent panel: the bar renders above composer-area with the derived segments (AC2)', () => {
		const { target, cleanup } = mountPanel(seed());
		const bar = target.querySelector('[data-testid="conversation-stats-bar"]');
		expect(bar).not.toBeNull();
		expect(bar?.textContent).toContain('1 turns · 1 steps');
		expect(bar?.textContent).toContain('Cache hit 90%');
		const composer = target.querySelector('.composer-area');
		expect(composer).not.toBeNull();
		// bar strictly precedes the composer block in document order
		expect((bar as Element).compareDocumentPosition(composer as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		cleanup();
	});

	it('sub-agent panel: the bar is the bottom in-flow row; composer stays fenced out; stick toggle overlays (AC3)', () => {
		const { target, cleanup } = mountPanel(seed(), true);
		const bar = target.querySelector('[data-testid="conversation-stats-bar"]');
		expect(bar).not.toBeNull();
		expect(target.querySelector('.composer-area')).toBeNull();
		expect(target.querySelector('[data-testid="floating-stick-toggle"]')).not.toBeNull();
		// nothing in-flow follows the bar: the only later siblings are the
		// fenced-out placeholders and the floating stick OVERLAY (happy-dom
		// cannot resolve scoped position styles — repo-probed — so the
		// in-flow/overlay split is asserted by testid identity here; the
		// real geometry is pinned by tests/e2e/stats-bar.spec.ts)
		const column = bar!.parentElement as HTMLElement;
		const after = [...column.children].slice([...column.children].indexOf(bar!) + 1);
		expect(after.map((el) => el.getAttribute('data-testid') ?? '').join(',')).not.toContain('composer');
		cleanup();
	});
});
