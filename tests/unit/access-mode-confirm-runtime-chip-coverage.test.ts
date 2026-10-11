/**
 * Coverage round-up tests — AccessModeConfirm + RuntimeContextChip
 * (both sat at the 80% per-file floor). Exercises the branch arms the
 * sibling suites leave out: undefined-prop default fallbacks, every
 * boolean arm of the acknowledge/disabled gate, promise-returning
 * onconfirm, toggle re-close, and both truncate arms (head + '…').
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AccessModeConfirm from '$lib/components/composer/access-mode/AccessModeConfirm.svelte';
import RuntimeContextChip from '$lib/components/message/chips/RuntimeContextChip.svelte';

let host: HTMLElement;

beforeEach(() => {
	host = document.body.appendChild(document.createElement('div'));
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('AccessModeConfirm — remaining branch arms', () => {
	it('every prop supplied explicitly (all defaults bypassed) still renders and gates', () => {
		const oncancel = vi.fn();
		const onconfirm = vi.fn().mockResolvedValue(undefined);
		const comp = mount(AccessModeConfirm, {
			target: host,
			props: { disabled: false, pos: { x: 10, y: 20 }, oncancel, onconfirm }
		});
		flushSync();
		const mask = document.body.querySelector('[data-testid="access-mode-confirm"]') as HTMLElement;
		expect(mask).not.toBeNull();
		// pos arm of the ternary
		const card = mask.firstElementChild as HTMLElement;
		expect(card.getAttribute('style')!.replace(/\s/g, '')).toContain('left:10px;top:20px');
		// acknowledged=false && disabled=false → disabled arm of !acknowledged
		const enable = document.body.querySelector('[data-testid="access-mode-enable"]') as HTMLButtonElement;
		expect(enable.disabled).toBe(true);
		// confirm path with a PROMISE-returning onconfirm (void onconfirm() arm)
		(document.body.querySelector('[data-testid="access-mode-acknowledge"]') as HTMLInputElement).click();
		flushSync();
		expect(enable.disabled).toBe(false);
		enable.click();
		expect(onconfirm).toHaveBeenCalledTimes(1);
		unmount(comp);
	});

	it('undefined disabled/pos props hit the default fallbacks; Escape + backdrop cancel', () => {
		const oncancel = vi.fn();
		const comp = mount(AccessModeConfirm, {
			target: host,
			props: { disabled: undefined, pos: undefined, oncancel, onconfirm: () => {} } as never
		});
		flushSync();
		const mask = document.body.querySelector('[data-testid="access-mode-confirm"]') as HTMLElement;
		const card = mask.firstElementChild as HTMLElement;
		// null-pos arm → viewport-center fallback
		expect(card.getAttribute('style')!.replace(/\s/g, '')).toContain('left:50%');
		// both arms of the Escape keydown check
		mask.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(oncancel).not.toHaveBeenCalled();
		mask.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(oncancel).toHaveBeenCalledTimes(1);
		// backdrop-click target === currentTarget arm
		mask.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(oncancel).toHaveBeenCalledTimes(2);
		// nested-target click does not cancel
		const inner = document.createElement('span');
		card.appendChild(inner);
		inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(oncancel).toHaveBeenCalledTimes(2);
		unmount(comp);
		// portal cleanup removes the mask from document.body
		expect(document.body.querySelector('[data-testid="access-mode-confirm"]')).toBeNull();
	});

	it('disabled=true keeps Enable locked (|| arm) even after acknowledging; Cancel still fires', () => {
		const oncancel = vi.fn();
		const onconfirm = vi.fn();
		const comp = mount(AccessModeConfirm, {
			target: host,
			props: { disabled: true, oncancel, onconfirm }
		});
		flushSync();
		const ack = document.body.querySelector('[data-testid="access-mode-acknowledge"]') as HTMLInputElement;
		ack.click();
		flushSync();
		const enable = document.body.querySelector('[data-testid="access-mode-enable"]') as HTMLButtonElement;
		expect(enable.disabled).toBe(true);
		// clicking a disabled button must NOT confirm
		enable.click();
		expect(onconfirm).not.toHaveBeenCalled();
		(document.body.querySelector('[data-testid="access-mode-cancel"]') as HTMLElement).click();
		expect(oncancel).toHaveBeenCalledTimes(1);
		unmount(comp);
	});
});

describe('RuntimeContextChip — remaining branch arms', () => {
	it('short text: truncated=false arm, closed by default, toggle opens then re-closes', () => {
		const comp = mount(RuntimeContextChip, { target: host, props: { text: 'short payload' } });
		flushSync();
		const chip = host.querySelector('[data-testid="runtime-context-chip"]') as HTMLElement;
		expect(chip.getAttribute('data-open')).toBe('false');
		expect(chip.querySelector('[data-testid="runtime-context-body"]')).toBeNull();
		const btn = chip.querySelector('[data-testid="runtime-context-toggle"]') as HTMLButtonElement;
		expect(btn.getAttribute('aria-expanded')).toBe('false');
		expect(chip.textContent).not.toContain('…'); // truncated=false arm
		btn.click();
		flushSync();
		expect(chip.getAttribute('data-open')).toBe('true');
		expect(btn.getAttribute('aria-expanded')).toBe('true');
		expect(chip.textContent).toContain('▾'); // open arrow arm
		expect(chip.querySelector('[data-testid="runtime-context-body"]')!.textContent).toBe('short payload');
		btn.click();
		flushSync();
		expect(chip.getAttribute('data-open')).toBe('false');
		expect(chip.querySelector('[data-testid="runtime-context-body"]')).toBeNull(); // {#if} false arm
		expect(chip.textContent).toContain('▸'); // closed arrow arm
		unmount(comp);
	});

	it('long text: whitespace collapse + truncate → the … suffix arm', () => {
		const comp = mount(RuntimeContextChip, {
			target: host,
			props: { text: 'line one\n\nline two\twith tabs   and    many   spaces then a long tail of text that certainly passes the eighty character limit easily' }
		});
		flushSync();
		const chip = host.querySelector('[data-testid="runtime-context-chip"]') as HTMLElement;
		const label = chip.querySelector('[data-testid="runtime-context-toggle"]')!.textContent ?? '';
		expect(label).toContain('…'); // truncated=true arm
		// collapsed head keeps only 80 chars of the normalized text
		expect(label.length).toBeLessThan('Runtime context '.length + 100);
		// the verbatim body (open state) keeps the RAW text, newlines intact
		(chip.querySelector('[data-testid="runtime-context-toggle"]') as HTMLElement).click();
		flushSync();
		const body = chip.querySelector('[data-testid="runtime-context-body"]')!.textContent ?? '';
		expect(body).toContain('\n');
		expect(body).toContain('eighty character limit');
		unmount(comp);
	});

	it('empty text: closed body is null; opening evaluates the body interpolation to empty', () => {
		const comp = mount(RuntimeContextChip, { target: host, props: { text: '' } });
		flushSync();
		const chip = host.querySelector('[data-testid="runtime-context-chip"]') as HTMLElement;
		expect(chip).not.toBeNull();
		expect(chip.querySelector('[data-testid="runtime-context-body"]')).toBeNull();
		// opening evaluates the <pre>{text}</pre> body interpolation
		(chip.querySelector('[data-testid="runtime-context-toggle"]') as HTMLElement).click();
		flushSync();
		expect(chip.querySelector('[data-testid="runtime-context-body"]')!.textContent).toBe('');
		unmount(comp);
	});

	it('boundary: exactly 80 chars takes the no-truncate arm of length <= max', () => {
		const comp = mount(RuntimeContextChip, { target: host, props: { text: 'x'.repeat(80) } });
		flushSync();
		const chip = host.querySelector('[data-testid="runtime-context-chip"]') as HTMLElement;
		expect(chip.textContent).not.toContain('…');
		expect(chip.textContent).toContain('x'.repeat(80));
		unmount(comp);
	});

	it('boundary: 81 chars cuts one char and flags the ellipsis arm', () => {
		const comp = mount(RuntimeContextChip, { target: host, props: { text: 'y'.repeat(81) } });
		flushSync();
		const chip = host.querySelector('[data-testid="runtime-context-chip"]') as HTMLElement;
		expect(chip.textContent).toContain('…');
		expect(chip.textContent).toContain('y'.repeat(80));
		unmount(comp);
	});

	it('whitespace-only text normalizes to an empty head without the ellipsis', () => {
		const comp = mount(RuntimeContextChip, { target: host, props: { text: '  \n\t  ' } });
		flushSync();
		const chip = host.querySelector('[data-testid="runtime-context-chip"]') as HTMLElement;
		expect(chip.textContent).not.toContain('…');
		expect(chip.textContent).toContain('runtime context');
		expect(chip.textContent!.trim().endsWith('·')).toBe(true); // empty head, separator tail
		unmount(comp);
	});
});