/**
 * StripChip unit tests — one suggestion row of the prompt strip, direct
 * mounted (suggest-strip.test.ts drives the whole strip through
 * SuggestStrip; this suite pins the chip's own contract):
 *
 *  - pick: option role, active flag, preview highlight, ⏎ badge on
 *    multiline rows, use count, click → onpick
 *  - ⏯ Step: run mode + handler only; click reports and stops propagation
 *  - ⋯ menu: open/closed toggle; the popup (edit form prefilled from the
 *    row, strip-aligned position when inside a .suggest-strip, bare
 *    style otherwise), Esc closes (+ host refocus callback), Save and
 *    Delete report through their callbacks and close the popup
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StripChip from '$lib/components/composer/menu/suggest-strip/StripChip.svelte';
import StripChipHost from '../../../../../fixtures/StripChipHost.svelte';
import type { SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';

function row(over: Partial<SuggestedPrompt> = {}): SuggestedPrompt {
	return { id: 1, label: 'Deploy', text: 'deploy the app', use_count: 3, macro: 0, last_used_at: '', tags: '', ...over };
}

/** Typed mocks — bare vi.fn() carries a Mock<Procedure|Constructable>
 *  type that svelte-check rejects against function props. */
type Callbacks = {
	onpick: ReturnType<typeof vi.fn<() => void>>;
	onstep?: ReturnType<typeof vi.fn<() => void>>;
	onrename: ReturnType<typeof vi.fn<(row: SuggestedPrompt, fields: { uses: string; label: string; text: string }) => void>>;
	ondelete: ReturnType<typeof vi.fn<(row: SuggestedPrompt) => void>>;
	onclose: ReturnType<typeof vi.fn<() => void>>;
	onmenuopen: ReturnType<typeof vi.fn<(id: number) => void>>;
	onmenuclose: ReturnType<typeof vi.fn<() => void>>;
};

function callbacks(): Callbacks {
	return {
		onpick: vi.fn<() => void>(),
		onstep: vi.fn<() => void>(),
		onrename: vi.fn<(row: SuggestedPrompt, fields: { uses: string; label: string; text: string }) => void>(),
		ondelete: vi.fn<(row: SuggestedPrompt) => void>(),
		onclose: vi.fn<() => void>(),
		onmenuopen: vi.fn<(id: number) => void>(),
		onmenuclose: vi.fn<() => void>()
	};
}

function mountChip(
	r: SuggestedPrompt,
	cb: Callbacks,
	opts: { inStrip?: boolean; menuOpen?: boolean; active?: boolean; mode?: 'find' | 'run'; query?: string } = {}
): { target: HTMLElement; instance: ReturnType<typeof mount> } {
	const host = document.createElement('div');
	if (opts.inStrip) {
		host.className = 'suggest-strip';
		Object.defineProperty(host, 'getBoundingClientRect', {
			configurable: true,
			value: () =>
				({ left: 12, top: 20, width: 300, height: 24, right: 312, bottom: 44, x: 12, y: 20, toJSON: () => ({}) })
		});
	}
	const target = document.createElement('div');
	host.appendChild(target);
	document.body.appendChild(host);
	const instance = mount(StripChip, {
		target,
		props: {
			row: r,
			active: opts.active ?? false,
			query: opts.query ?? '',
			mode: opts.mode ?? 'find',
			menuOpen: opts.menuOpen ?? false,
			...cb
		}
	});
	flushSync();
	return { target, instance };
}

function menuButton(target: HTMLElement): HTMLElement {
	return target.querySelector('[aria-label="Prompt options"]')!;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('StripChip — the pick row', () => {
	it('renders the option role, the active flag, the title, and the use count', () => {
		const cb = callbacks();
		const { target, instance } = mountChip(row(), cb, { active: true });
		const pick = target.querySelector('[role="option"]') as HTMLElement;
		expect(pick.getAttribute('aria-selected')).toBe('true');
		expect(pick.getAttribute('title')).toBe('deploy the app');
		expect(pick.textContent).toContain('×3');
		unmount(instance);
	});

	it('an inactive row reports aria-selected false', () => {
		const cb = callbacks();
		const { target, instance } = mountChip(row(), cb, { active: false });
		expect((target.querySelector('[role="option"]') as HTMLElement).getAttribute('aria-selected')).toBe('false');
		unmount(instance);
	});

	it('clicking the row picks it', () => {
		const cb = callbacks();
		const { target, instance } = mountChip(row(), cb);
		(target.querySelector('[role="option"]') as HTMLElement).click();
		expect(cb.onpick).toHaveBeenCalledOnce();
		unmount(instance);
	});

	it('the live query (?-triggered) highlights its matched fragment', () => {
		const cb = callbacks();
		const { target, instance } = mountChip(row(), cb, { query: '?dep' });
		const hl = target.querySelector('.hl');
		expect(hl?.textContent).toBe('Dep');
		unmount(instance);
	});

	it('a non-matching ?query renders no highlight', () => {
		const cb = callbacks();
		const { target, instance } = mountChip(row(), cb, { query: '?zzz' });
		expect(target.querySelector('.hl')).toBeNull();
		unmount(instance);
	});

	it('a multiline row shows the ⏎ badge; a one-liner does not', () => {
		const cb = callbacks();
		const multi = mountChip(row({ text: 'line one\nline two' }), cb);
		expect(multi.target.querySelector('.strip-ml')).not.toBeNull();
		unmount(multi.instance);
		const single = mountChip(row(), cb);
		expect(single.target.querySelector('.strip-ml')).toBeNull();
		unmount(single.instance);
	});
});

describe('StripChip — the ⏯ Step control', () => {
	it('run mode with a handler renders it; click reports the step', () => {
		const cb = callbacks();
		const { target, instance } = mountChip(row(), cb, { mode: 'run' });
		const step = target.querySelector('[aria-label="Step this macro"]') as HTMLElement;
		expect(step).not.toBeNull();
		step.click();
		expect(cb.onstep).toHaveBeenCalledOnce();
		unmount(instance);
	});

	it('find mode hides it even with a handler', () => {
		const cb = callbacks();
		const { target, instance } = mountChip(row(), cb, { mode: 'find' });
		expect(target.querySelector('[aria-label="Step this macro"]')).toBeNull();
		unmount(instance);
	});

	it('run mode without a handler hides it too', () => {
		const cb = callbacks();
		const { target, instance } = mountChip(row(), { ...cb, onstep: undefined }, { mode: 'run' });
		expect(target.querySelector('[aria-label="Step this macro"]')).toBeNull();
		unmount(instance);
	});
});

describe('StripChip — the ⋯ menu toggle', () => {
	it('opening reports the row id; while open the same button closes', () => {
		const cb = callbacks();
		const { target, instance } = mountChip(row(), cb);
		menuButton(target).click();
		expect(cb.onmenuopen).toHaveBeenCalledWith(1);
		unmount(instance);

		const openCb = callbacks(); // fresh callbacks — the first mount's open is not contamination
		const open = mountChip(row(), openCb, { menuOpen: true });
		menuButton(open.target).click();
		expect(openCb.onmenuclose).toHaveBeenCalledOnce();
		expect(openCb.onmenuopen).not.toHaveBeenCalled();
		unmount(open.instance);
	});

	it('inside a .suggest-strip the opened popup is strip-aligned (live toggle, host-driven render)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(StripChipHost, { target, props: { row: row(), inStrip: true } });
		flushSync();
		const strip = target.querySelector('.suggest-strip') as HTMLElement;
		Object.defineProperty(strip, 'getBoundingClientRect', {
			configurable: true,
			value: () =>
				({ left: 12, top: 20, width: 300, height: 24, right: 312, bottom: 44, x: 12, y: 20, toJSON: () => ({}) })
		});
		menuButton(target).click();
		flushSync();
		const pop = document.querySelector('.strip-menu-pop') as HTMLElement;
		expect(pop).not.toBeNull();
		// happy-dom serializes the style text with spaces after colons.
		expect(pop.getAttribute('style')).toContain('left: 12px');
		expect(pop.getAttribute('style')).toContain('width: 300px');
		unmount(instance);
		expect(document.querySelector('.strip-menu-pop')).toBeNull(); // portal cleanup
	});

	it('outside any strip the popup still opens, with no inline position', () => {
		const cb = callbacks();
		const { target, instance } = mountChip(row(), cb, { menuOpen: true });
		const pop = document.querySelector('.strip-menu-pop') as HTMLElement;
		expect(pop).not.toBeNull();
		expect(pop.getAttribute('style') ?? '').not.toContain('left:');
		unmount(instance);
	});
});

describe('StripChip — the popup form', () => {
	it('prefills uses/label/text from the CURRENT row; a null label prefills empty', () => {
		const cb = callbacks();
		const withLabel = mountChip(row(), cb, { menuOpen: true });
		expect((document.querySelector('.strip-menu-uses') as HTMLInputElement).value).toBe('3');
		expect((document.querySelector('[aria-label="Prompt label"]') as HTMLInputElement).value).toBe(
			'Deploy'
		);
		expect((document.querySelector('.strip-menu-text') as HTMLTextAreaElement).value).toBe(
			'deploy the app'
		);
		unmount(withLabel.instance);

		const nullLabel = mountChip(row({ label: null }), callbacks(), { menuOpen: true });
		expect((document.querySelector('[aria-label="Prompt label"]') as HTMLInputElement).value).toBe('');
		unmount(nullLabel.instance);
	});

	it('Escape closes the menu and refocuses the host through onclose', () => {
		const cb = callbacks();
		const { instance } = mountChip(row(), cb, { menuOpen: true });
		const pop = document.querySelector('.strip-menu-pop') as HTMLElement;
		pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(cb.onmenuclose).toHaveBeenCalledOnce();
		expect(cb.onclose).toHaveBeenCalledOnce();
		unmount(instance);
	});

	it('Save reports the edited fields and closes the menu', () => {
		const cb = callbacks();
		const { instance } = mountChip(row(), cb, { menuOpen: true });
		(document.querySelector('.strip-menu-text') as HTMLTextAreaElement).value = 'edited body';
		(document.querySelector('.strip-menu-text') as HTMLTextAreaElement).dispatchEvent(new Event('input'));
		flushSync();
		(document.querySelector('.strip-menu-save') as HTMLElement).click();
		expect(cb.onmenuclose).toHaveBeenCalledOnce();
		expect(cb.onrename).toHaveBeenCalledWith(row(), { uses: '3', label: 'Deploy', text: 'edited body' });
		unmount(instance);
	});

	it('Delete reports the row and closes the menu', () => {
		const cb = callbacks();
		const r = row();
		const { instance } = mountChip(r, cb, { menuOpen: true });
		(document.querySelector('.strip-menu-delete') as HTMLElement).click();
		expect(cb.ondelete).toHaveBeenCalledWith(r);
		expect(cb.onmenuclose).toHaveBeenCalledOnce();
		unmount(instance);
	});

	it('the popup portals to document.body and focuses the Uses field', () => {
		const cb = callbacks();
		const { instance } = mountChip(row(), cb, { menuOpen: true });
		expect(document.querySelector('.strip-menu-pop')).not.toBeNull();
		expect(document.activeElement?.classList.contains('strip-menu-input')).toBe(true);
		unmount(instance);
	});

	describe('textarea sizing (canvas measurement)', () => {
		/** happy-dom has no 2d canvas and no computed styles — stub both:
		 *  16px line height, 6px vertical paddings, controllable measurer. */
		function stubLayout(measure: (text: string) => number): void {
			vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
				font: '',
				measureText: (t: string) => ({ width: measure(t) })
			} as unknown as CanvasRenderingContext2D);
			vi.spyOn(window, 'getComputedStyle').mockReturnValue({
				lineHeight: '16px',
				fontSize: '12px',
				fontFamily: 'monospace',
				paddingTop: '6px',
				paddingBottom: '6px'
			} as unknown as CSSStyleDeclaration);
		}

		it('a longest line wider than the strip adds the h-scroll extra row', () => {
			stubLayout((t) => t.length * 100); // every line ≫ the strip width
			try {
				const cb = callbacks();
				const { instance } = mountChip(row({ text: 'one\ntwo' }), cb, { menuOpen: true, inStrip: true });
				const ta = document.querySelector('.strip-menu-text') as HTMLTextAreaElement;
				// 2 lines × 16 + 16 extra row + 6 + 6 + 4 = 64 — over the floor, under the cap.
				expect(ta.style.height).toBe('64px');
				expect(ta.style.overflowY).toBe('hidden');
				unmount(instance);
			} finally {
				vi.restoreAllMocks();
			}
		});

		it('measured-narrow content clamps at the 48px floor with hidden overflow', () => {
			stubLayout(() => 0);
			try {
				const cb = callbacks();
				const { instance } = mountChip(row(), cb, { menuOpen: true, inStrip: true });
				const ta = document.querySelector('.strip-menu-text') as HTMLTextAreaElement;
				// 1 × 16 + 0 + 16 = 32 → the 48px floor wins; the strip-width arm of the
				// h-scroll check evaluated (strip-aligned menuPos) and found nothing.
				expect(ta.style.height).toBe('48px');
				expect(ta.style.overflowY).toBe('hidden');
				unmount(instance);
			} finally {
				vi.restoreAllMocks();
			}
		});

		it('a many-line text overflows: the height caps and the scroller engages', () => {
			stubLayout(() => 0);
			try {
				const many = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
				const cb = callbacks();
				const { instance } = mountChip(row({ text: many }), cb, { menuOpen: true, inStrip: true });
				const ta = document.querySelector('.strip-menu-text') as HTMLTextAreaElement;
				expect(ta.style.overflowY).toBe('auto');
				expect(parseFloat(ta.style.height)).toBeLessThan(100 * 16); // capped, not grown
				unmount(instance);
			} finally {
				vi.restoreAllMocks();
			}
		});

		it('a bare host sizes with the menuPos-null 0 fallback width (wide and narrow)', () => {
			stubLayout((t) => t.length * 100);
			try {
				const cb = callbacks();
				const wide = mountChip(row({ text: 'one\ntwo' }), cb, { menuOpen: true }); // never in a strip
				const ta = document.querySelector('.strip-menu-text') as HTMLTextAreaElement;
				expect(ta.style.height).toBe('64px'); // clientWidth 0 < measured → extra row
				unmount(wide.instance);

				document.body.innerHTML = '';
				vi.mocked(HTMLCanvasElement.prototype.getContext).mockClear?.();
				const narrow = mountChip(row(), callbacks(), { menuOpen: true });
				const ta2 = document.querySelector('.strip-menu-text') as HTMLTextAreaElement;
				// No menuPos: the strip-width arm falls back to 0 — still no h-scroll.
				expect(ta2.style.height).toBe('48px');
				unmount(narrow.instance);
			} finally {
				vi.restoreAllMocks();
			}
		});
	});
});
