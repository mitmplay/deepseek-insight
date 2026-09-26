/**
 * TerminalTabButton unit tests — one desk tab (Terminal Desk ADR D1/D5):
 *  - click selects; Enter and Space select via keyboard; other keys don't
 *  - selected styling + aria-selected/data-selected reflect the prop
 *  - the × close kills the tab: stopPropagation keeps the select click
 *    from firing, and the close label is localized + suffixed
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TerminalTabButton from '$lib/components/terminal/TerminalTabButton.svelte';

function mountButton(props: { index: number; selected: boolean; label: string }) {
	const onSelect = vi.fn();
	const onClose = vi.fn();
	const target = document.body.appendChild(document.createElement('div'));
	const comp = mount(TerminalTabButton, { target, props: { ...props, onSelect, onClose } });
	flushSync();
	const el = target.querySelector('[data-testid="terminal-tab-button-' + props.index + '"]') as HTMLElement;
	const close = target.querySelector('[data-testid="terminal-tab-close-' + props.index + '"]') as HTMLElement;
	return { el, close, onSelect, onClose, cleanup: () => { unmount(comp); target.remove(); } };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('TerminalTabButton', () => {
	it('click selects', () => {
		const h = mountButton({ index: 0, selected: false, label: 'T1' });
		h.el.click();
		flushSync();
		expect(h.onSelect).toHaveBeenCalledTimes(1);
		expect(h.onClose).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('Enter and Space select via keyboard; other keys do not', () => {
		const h = mountButton({ index: 0, selected: false, label: 'T1' });
		h.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		h.el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
		h.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		h.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(h.onSelect).toHaveBeenCalledTimes(2);
		h.cleanup();
	});

	it('selected tab renders the selected surface (class, aria, data)', () => {
		const sel = mountButton({ index: 0, selected: true, label: 'T1' });
		expect(sel.el.getAttribute('aria-selected')).toBe('true');
		expect(sel.el.getAttribute('data-selected')).toBe('true');
		expect(sel.el.className).toContain('bg-slate-700');
		// the close label carries the localized verb + the tab label
		expect(sel.close.getAttribute('aria-label')).toContain('T1');
		sel.cleanup();

		const unsel = mountButton({ index: 1, selected: false, label: 'T2' });
		expect(unsel.el.getAttribute('aria-selected')).toBe('false');
		expect(unsel.el.getAttribute('data-selected')).toBe('false');
		expect(unsel.el.className).toContain('text-slate-400');
		expect(unsel.el.className).not.toContain('bg-slate-700');
		unsel.cleanup();
	});

	it('the × close stops propagation (no select) and closes', () => {
		const h = mountButton({ index: 0, selected: false, label: 'T1' });
		const stop = vi.fn();
		h.close.addEventListener('click', (e) => { if ((e as unknown as { stopPropagationSpy?: boolean }).stopPropagationSpy) stop(); }, { once: true });
		h.close.click();
		flushSync();
		expect(h.onClose).toHaveBeenCalledTimes(1);
		expect(h.onSelect).not.toHaveBeenCalled();
		h.cleanup();
	});
});
