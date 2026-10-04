/**
 * TurnUsagePanel — The Exact Total (ADR-0012, task 2.1-T).
 *
 * Three display shapes (PRD §5): a bucketless provider turn (headline =
 * exact total, implied cached row, rows sum to the headline), a fully
 * bucketed turn (provider row wins, no implied row), and a mixed turn
 * (no total carried → bucket-sum headline, no implied row).
 */
import { flushSync } from 'svelte';
import { mount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import TurnUsagePanel from '$lib/components/message/assistant/TurnUsagePanel.svelte';
import type { DsiTokenUsage } from '$lib/types';

afterEach(() => {
	document.body.innerHTML = '';
});

const render = (usage: DsiTokenUsage): HTMLElement => {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(TurnUsagePanel, { target, props: { usage } });
	flushSync();
	return target;
};

const zai: DsiTokenUsage = {
	inputTokens: 11302, outputTokens: 205, totalTokens: 22259,
	provider: 'zai', model: 'glm-5.3-flash'
};

/** jsdom's .click() does not bubble — Svelte 5 delegated handlers miss it. */
const openPopup = (t: HTMLElement): void => {
	(t.querySelector('[data-testid="turn-usage"] button') as HTMLButtonElement)
		.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
	flushSync();
};

describe('TurnUsagePanel — rows sum to the headline (ADR-0012 D2)', () => {
	it('bucketless turn: headline is the exact total, implied row closes the gap', () => {
		const t = render(zai);
		expect(t.textContent).toContain('22,259');
		openPopup(t);
		const popup = t.querySelector('[data-testid="turn-usage-popup"]');
		expect(popup?.textContent).toContain('~10,752'); // 22259 − 11302 − 205, marked implied
		expect(popup?.textContent).toContain('implied');
		// rows sum: 11302 + 10752 + 205
		const rows = [...popup!.querySelectorAll('dd')].map((dd) => dd.textContent ?? '').join(' ');
		expect(rows).toContain('11,302');
		expect(rows).toContain('205');
	});

	it('bucketed turn: provider cache row wins, no implied row', () => {
		const t = render({ ...zai, cacheReadTokens: 9500 });
		openPopup(t);
		const popup = t.querySelector('[data-testid="turn-usage-popup"]');
		expect(popup?.textContent).toContain('9,500');
		expect(popup?.textContent).not.toContain('~');
		expect(popup?.textContent).toContain('43.1%'); // 9500 / (22259 − 205) = 43.08
	});

	it('mixed turn: no total carried → bucket-sum headline, no implied row', () => {
		const t = render({ inputTokens: 100, outputTokens: 5, provider: 'x', model: 'y' });
		expect(t.textContent).toContain('105');
		openPopup(t);
		expect(t.querySelector('[data-testid="turn-usage-popup"]')?.textContent).not.toContain('~');
	});
});
