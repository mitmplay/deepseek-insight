/**
 * AccessModeConfirm unit tests — the R7 Full access risk gate
 * (presentational): acknowledgement checkbox gates Enable; Escape /
 * mask-click / Cancel cancel; the portal lands on document.body; the
 * card positions from pos with the viewport-center fallback.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AccessModeConfirm from '$lib/components/composer/access-mode/AccessModeConfirm.svelte';

let host: HTMLElement;

beforeEach(() => {
	host = document.body.appendChild(document.createElement('div'));
});

afterEach(() => {
	document.body.innerHTML = '';
});

function mountGate(props: Record<string, unknown> = {}): { instance: ReturnType<typeof mount> } {
	const instance = mount(AccessModeConfirm, { target: host, props });
	flushSync();
	return { instance };
}

describe('AccessModeConfirm (the R7 gate)', () => {
	it('portals the mask to document.body and renders the warning copy', () => {
		mountGate();
		const mask = document.body.querySelector('[data-testid="access-mode-confirm"]');
		expect(mask).not.toBeNull();
		expect(mask!.getAttribute('role')).toBe('dialog');
		expect(mask!.getAttribute('aria-modal')).toBe('true');
		expect(document.body.textContent).toContain('Full access reduces confirmation steps');
	});

	it('Enable stays disabled until the acknowledgement is checked', () => {
		mountGate();
		const enable = document.body.querySelector('[data-testid="access-mode-enable"]') as HTMLButtonElement;
		expect(enable.disabled).toBe(true);
		const ack = document.body.querySelector('[data-testid="access-mode-acknowledge"]') as HTMLInputElement;
		ack.click();
		flushSync();
		expect(enable.disabled).toBe(false);
	});

	it('the submit lock keeps Enable disabled even with the acknowledgement', () => {
		mountGate({ disabled: true });
		const ack = document.body.querySelector('[data-testid="access-mode-acknowledge"]') as HTMLInputElement;
		ack.click();
		flushSync();
		const enable = document.body.querySelector('[data-testid="access-mode-enable"]') as HTMLButtonElement;
		expect(enable.disabled).toBe(true);
	});

	it('Enable fires onconfirm', async () => {
		const onconfirm = vi.fn();
		mountGate({ onconfirm });
		const ack = document.body.querySelector('[data-testid="access-mode-acknowledge"]') as HTMLInputElement;
		ack.click();
		flushSync();
		(document.body.querySelector('[data-testid="access-mode-enable"]') as HTMLElement).click();
		expect(onconfirm).toHaveBeenCalledTimes(1);
	});

	it('Cancel calls oncancel', () => {
		const oncancel = vi.fn();
		mountGate({ oncancel });
		(document.body.querySelector('[data-testid="access-mode-cancel"]') as HTMLElement).click();
		expect(oncancel).toHaveBeenCalledTimes(1);
	});

	it('Escape calls oncancel', () => {
		const oncancel = vi.fn();
		mountGate({ oncancel });
		const mask = document.body.querySelector('[data-testid="access-mode-confirm"]') as HTMLElement;
		mask.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(oncancel).toHaveBeenCalledTimes(1);
	});

	it('a mask BACKDROP click calls oncancel; a card click does not', () => {
		const oncancel = vi.fn();
		mountGate({ oncancel });
		const mask = document.body.querySelector('[data-testid="access-mode-confirm"]') as HTMLElement;
		// a click from inside the card (target ≠ mask) is ignored
		const card = mask.firstElementChild as HTMLElement;
		card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(oncancel).not.toHaveBeenCalled();
		// the backdrop itself closes
		mask.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(oncancel).toHaveBeenCalledTimes(1);
	});

	it('pos anchors the card; null pos falls back to the viewport center', () => {
		const { instance } = mountGate({ pos: { x: 120, y: 80 } });
		let card = (document.body.querySelector('[data-testid="access-mode-confirm"]') as HTMLElement).firstElementChild as HTMLElement;
		expect(card.getAttribute('style')!.replace(/\s/g, '')).toContain('left:120px');
		unmount(instance as never);
		document.body.innerHTML = '';
		host = document.body.appendChild(document.createElement('div'));
		mountGate({ pos: null });
		card = (document.body.querySelector('[data-testid="access-mode-confirm"]') as HTMLElement).firstElementChild as HTMLElement;
		expect(card.getAttribute('style')!.replace(/\s/g, '')).toContain('left:50%');
	});
});
