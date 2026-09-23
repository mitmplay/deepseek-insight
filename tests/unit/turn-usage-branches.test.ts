/**
 * TurnUsagePanel branch coverage — exercises the untaken arms of the
 * cacheHit ternary (undefined cacheRead / zero billedInput), the routes
 * fallbacks (undefined routes with/without provider+model), the optional
 * cacheWrite/cacheRead/reasoning ?? and !== undefined arms, and the
 * onoutside guard arms (closed, outside-close, inside-keep-open).
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import TurnUsagePanel from '$lib/components/message/TurnUsagePanel.svelte';
import type { DsiTokenUsage } from '$lib/types';

function mountPanel(props: { usage: DsiTokenUsage; class?: string }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(TurnUsagePanel, { target, props });
	return {
		target,
		pill: () => target.querySelector('[data-testid="turn-usage"] button') as HTMLElement,
		open: () => {
			(target.querySelector('[data-testid="turn-usage"] button') as HTMLElement).click();
			flushSync();
			return target.querySelector('[data-testid="turn-usage-popup"]') as HTMLElement;
		},
		unmount: () => unmount(comp)
	};
}

describe('TurnUsagePanel — branch arms', () => {
	it('undefined cacheRead/cacheWrite/reasoning: total falls back to 0 arms, cache/cached/reasoning rows hidden', () => {
		const h = mountPanel({ usage: { inputTokens: 100, outputTokens: 20 } });
		expect(h.pill().textContent).toBe('Usage 120 tok');
		const popup = h.open();
		expect(popup.textContent).not.toContain('Cache hit');
		expect(popup.textContent).not.toContain('Cached input');
		expect(popup.textContent).not.toContain('reasoning');
		expect(popup.textContent).toContain('100');
		h.unmount();
	});

	it('cacheRead defined but billedInput 0 (zero everything): cacheHit takes the null arm', () => {
		const h = mountPanel({ usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } });
		const popup = h.open();
		expect(popup.textContent).not.toContain('Cache hit');
		// zero cacheRead still renders the Cached input row with 0 (!== undefined arm)
		expect(popup.textContent).toContain('Cached input');
		h.unmount();
	});

	it('no routes and no provider/model: routes derives to empty string, provider row hidden', () => {
		const h = mountPanel({ usage: { inputTokens: 5, outputTokens: 6 } });
		const popup = h.open();
		expect(popup.textContent).not.toContain('Provider / model');
		h.unmount();
	});

	it('no routes but provider+model defined: fallback single-route arm renders provider/model', () => {
		const h = mountPanel({
			usage: { inputTokens: 5, outputTokens: 6, provider: 'openai', model: 'gpt-4o' }
		});
		const popup = h.open();
		expect(popup.textContent).toContain('Provider / model');
		expect(popup.textContent).toContain('openai/gpt-4o');
		h.unmount();
	});

	it('outside pointerdown closes the popup; inside pointerdown keeps it open', () => {
		const h = mountPanel({ usage: { inputTokens: 5, outputTokens: 6 } });
		h.open();
		expect(h.target.querySelector('[data-testid="turn-usage-popup"]')).not.toBeNull();
		// pointerdown inside the pill → contains arm keeps it open
		(h.target.querySelector('[data-testid="turn-usage"]') as HTMLElement).dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true })
		);
		flushSync();
		expect(h.target.querySelector('[data-testid="turn-usage-popup"]')).not.toBeNull();
		// pointerdown on document outside → closes
		document.dispatchEvent(new PointerEvent('pointerdown'));
		flushSync();
		expect(h.target.querySelector('[data-testid="turn-usage-popup"]')).toBeNull();
		// already-closed arm: another outside pointerdown is a no-op, no error
		document.dispatchEvent(new PointerEvent('pointerdown'));
		flushSync();
		expect(h.target.querySelector('[data-testid="turn-usage-popup"]')).toBeNull();
		h.unmount();
	});

	it('Escape key closes; toggle button flips open back open', () => {
		const h = mountPanel({ usage: { inputTokens: 5, outputTokens: 6 } });
		h.open();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(h.target.querySelector('[data-testid="turn-usage-popup"]')).toBeNull();
		h.pill().click();
		flushSync();
		expect(h.target.querySelector('[data-testid="turn-usage-popup"]')).not.toBeNull();
		h.pill().click();
		flushSync();
		expect(h.target.querySelector('[data-testid="turn-usage-popup"]')).toBeNull();
		h.unmount();
	});

	it('non-zero cache read computes a percentage cache hit', () => {
		const h = mountPanel({
			usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 50 }
		});
		const popup = h.open();
		expect(popup.textContent).toContain('Cache hit');
		expect(popup.textContent).toContain('33.3%');
		h.unmount();
	});

	it('class prop rides on the root span', () => {
		const h = mountPanel({ usage: { inputTokens: 1, outputTokens: 1 }, class: 'ml-1' });
		expect((h.target.querySelector('[data-testid="turn-usage"]') as HTMLElement).className).toContain('ml-1');
		h.unmount();
	});
});
