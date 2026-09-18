/**
 * TokenCounter unit tests — the draft's live token estimate
 * (~4 chars/token heuristic): non-empty text rounds up per 4 chars,
 * empty text estimates zero.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import TokenCounter from '$lib/components/chat/TokenCounter.svelte';

function mountCounter(text: string) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(TokenCounter, { target, props: { text } });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('TokenCounter — the draft estimate', () => {
	it('counts ceil(chars / 4) tokens', () => {
		const { target, instance } = mountCounter('123456789');
		expect(target.querySelector('[data-testid="token-counter"]')?.textContent).toContain('~3 tokens');
		unmount(instance);
	});

	it('an empty draft estimates zero', () => {
		const { target, instance } = mountCounter('');
		expect(target.querySelector('[data-testid="token-counter"]')?.textContent).toContain('~0 tokens');
		unmount(instance);
	});
});
