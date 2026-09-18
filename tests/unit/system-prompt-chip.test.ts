/**
 * SystemPromptChip unit tests — the transcript's "System prompt"
 * disclosure pill:
 *  - collapsed by default: no body, chevron points right, aria-expanded=false
 *  - open: the body renders the prompt text VERBATIM in the pre block
 *    (model-facing bytes, not markdown — line breaks and angle brackets
 *    survive as text nodes), chevron points down, aria-expanded=true
 *  - the pill only REPORTS intent: clicking fires ontoggle once; it never
 *    flips its own open state, and a missing ontoggle is a safe no-op.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SystemPromptChip from '$lib/components/message/SystemPromptChip.svelte';

function mountChip(props: { text: string; open?: boolean; ontoggle?: () => void }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(SystemPromptChip, { target, props });
	flushSync();
	return { target, comp };
}

const toggle = (target: HTMLElement): HTMLButtonElement =>
	target.querySelector('[data-testid="system-prompt-toggle"]') as HTMLButtonElement;

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SystemPromptChip — collapsed state', () => {
	it('renders the pill closed by default: no body, aria-expanded=false, data-open=false', () => {
		const { target, comp } = mountChip({ text: 'You are a coding agent.' });
		const chip = target.querySelector('[data-testid="system-prompt-chip"]') as HTMLElement;
		expect(chip.getAttribute('data-open')).toBe('false');
		expect(toggle(target).getAttribute('aria-expanded')).toBe('false');
		expect(target.querySelector('[data-testid="system-prompt-body"]')).toBeNull();
		expect(toggle(target).textContent).toContain('System prompt');
		unmount(comp);
	});

	it('collapsed pill shows the right-pointing chevron', () => {
		const { target, comp } = mountChip({ text: 'prompt' });
		expect(target.querySelector('svg.lucide-chevron-right')).not.toBeNull();
		expect(target.querySelector('svg.lucide-chevron-down')).toBeNull();
		unmount(comp);
	});
});

describe('SystemPromptChip — open state', () => {
	it('open renders the body with the prompt text verbatim and aria-expanded=true', () => {
		const prompt = 'You are a coding agent.\nRule two.\nRule three.';
		const { target, comp } = mountChip({ text: prompt, open: true });
		const chip = target.querySelector('[data-testid="system-prompt-chip"]') as HTMLElement;
		const body = target.querySelector('[data-testid="system-prompt-body"]') as HTMLElement;
		expect(chip.getAttribute('data-open')).toBe('true');
		expect(toggle(target).getAttribute('aria-expanded')).toBe('true');
		expect(body).not.toBeNull();
		const pre = body.querySelector('pre') as HTMLElement;
		expect(pre.textContent).toBe(prompt);
		unmount(comp);
	});

	it('open pill shows the down-pointing chevron (no right chevron)', () => {
		const { target, comp } = mountChip({ text: 'prompt', open: true });
		expect(target.querySelector('svg.lucide-chevron-down')).not.toBeNull();
		expect(target.querySelector('svg.lucide-chevron-right')).toBeNull();
		unmount(comp);
	});

	it('BC-12 parity: model-facing text renders as text nodes — markup and line breaks inert', () => {
		const prompt = '<script>alert(1)</script>\n**not bold**\nline three';
		const { target, comp } = mountChip({ text: prompt, open: true });
		const body = target.querySelector('[data-testid="system-prompt-body"]') as HTMLElement;
		expect(target.querySelector('script')).toBeNull();
		expect(body.querySelector('strong')).toBeNull();
		// The wire's exact bytes — no markdown reflow, no element split.
		expect(body.textContent).toBe(prompt);
		expect(body.querySelectorAll('p')).toHaveLength(0);
		unmount(comp);
	});

	it('open with empty text still renders the body (empty pre)', () => {
		const { target, comp } = mountChip({ text: '', open: true });
		const body = target.querySelector('[data-testid="system-prompt-body"]') as HTMLElement;
		expect(body).not.toBeNull();
		expect((body.querySelector('pre') as HTMLElement).textContent).toBe('');
		unmount(comp);
	});
});

describe('SystemPromptChip — toggle reporting', () => {
	it('clicking the pill fires ontoggle exactly once', () => {
		const ontoggle = vi.fn();
		const { target, comp } = mountChip({ text: 'prompt', ontoggle });
		toggle(target).click();
		flushSync();
		expect(ontoggle).toHaveBeenCalledTimes(1);
		unmount(comp);
	});

	it('the chip never flips its own open state (open stays page-owned)', () => {
		const { target, comp } = mountChip({ text: 'prompt' });
		toggle(target).click();
		flushSync();
		expect(toggle(target).getAttribute('aria-expanded')).toBe('false');
		expect(target.querySelector('[data-testid="system-prompt-body"]')).toBeNull();
		unmount(comp);
	});

	it('no ontoggle handler → click is a safe no-op', () => {
		const { target, comp } = mountChip({ text: 'prompt' });
		expect(() => {
			toggle(target).click();
			flushSync();
		}).not.toThrow();
		unmount(comp);
	});
});
