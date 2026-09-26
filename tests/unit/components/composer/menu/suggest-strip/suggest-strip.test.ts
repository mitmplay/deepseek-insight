/**
 * suggest-strip tests (task 2.2-T): empty rows render nothing; row click
 * fires pick; ⋯ menu exclusivity; manage button callback; highlight
 * fragment rendering with a live query.
 *
 * Mounts SuggestStrip directly (presentational component — no textarea,
 * no fetch) and asserts DOM behavior. happy-dom has real geometry APIs
 * (getBoundingClientRect returns zeros but no error), so portal-based
 * popups mount and callback fire without pixel assertions.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SuggestStrip from '$lib/components/composer/menu/suggest-strip/SuggestStrip.svelte';
import type { SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';

function row(partial: Partial<SuggestedPrompt> = {}): SuggestedPrompt {
	return {
		id: 1,
		label: null,
		text: 'load project AIP, OCI',
		use_count: 3,
		macro: 0,
		last_used_at: '2026-08-28T00:00:00.000Z',
	tags: '',
		...partial
	};
}

const rows = [
	row({ id: 11, text: 'load project AIP, OCI', use_count: 207 }),
	row({ id: 12, label: 'feature-spec', text: 'write the feature spec\nfrom the transcript', use_count: 100 })
];

function mountStrip(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onpick = vi.fn();
	const onrename = vi.fn();
	const ondelete = vi.fn();
	const onmanage = vi.fn();
	const onclose = vi.fn();
	const comp = mount(SuggestStrip, {
		target,
		props: {
			rows,
			activeIndex: 0,
			query: '',
			onpick,
			onrename,
			ondelete,
			onmanage,
			onclose,
			...props
		}
	});
	flushSync();
	const stripEl = () => target.querySelector('[data-testid="suggest-strip"]');
	const pickButtons = () => Array.from(target.querySelectorAll('.strip-pick'));
	const menuBtns = () => Array.from(target.querySelectorAll('.strip-menu-btn'));
	const manageBtn = () => target.querySelector('.strip-manage') as HTMLButtonElement | null;
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, stripEl, pickButtons, menuBtns, manageBtn, onpick, onrename, ondelete, onmanage, onclose, cleanup };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SuggestStrip — rendering', () => {
	it('empty rows render nothing (no strip element)', () => {
		const h = mountStrip({ rows: [] });
		expect(h.stripEl()).toBeNull();
		h.cleanup();
	});

	it('rows render as listbox options with use counts and ⏎ badge for multiline', () => {
		const h = mountStrip();
		expect(h.stripEl()).not.toBeNull();
		const picks = h.pickButtons();
		expect(picks).toHaveLength(2);
		expect(picks[0].getAttribute('role')).toBe('option');
		expect(picks[0].textContent).toContain('load project AIP, OCI');
		expect(picks[0].textContent).toContain('×207');
		expect(h.target.querySelectorAll('.strip-ml')).toHaveLength(1); // second row multiline
		expect(picks[1].textContent).toContain('feature-spec');
		h.cleanup();
	});

	it('active row carries aria-selected', () => {
		const h = mountStrip({ activeIndex: 1 });
		const picks = h.pickButtons();
		expect(picks[0].getAttribute('aria-selected')).toBe('false');
		expect(picks[1].getAttribute('aria-selected')).toBe('true');
		h.cleanup();
	});
});

describe('SuggestStrip — interactions', () => {
	it('row click fires pick with the row index', () => {
		const h = mountStrip();
		(h.pickButtons()[1] as HTMLButtonElement).click();
		flushSync();
		expect(h.onpick).toHaveBeenCalledWith(1);
		h.cleanup();
	});

	it('manage button fires onmanage', () => {
		const h = mountStrip();
		h.manageBtn()!.click();
		flushSync();
		expect(h.onmanage).toHaveBeenCalledTimes(1);
		h.cleanup();
	});

	it('manage button absent when onmanage is undefined', () => {
		const h = mountStrip({ onmanage: undefined });
		expect(h.manageBtn()).toBeNull();
		h.cleanup();
	});

	it('⋯ menu opens portaled to document.body; Save fires onrename with fields; closes on save', async () => {
		const h = mountStrip();
		(h.menuBtns()[0] as HTMLButtonElement).click();
		flushSync();
		const pop = document.body.querySelector('.strip-menu-pop');
		expect(pop).not.toBeNull();
		expect(pop!.closest('body')).toBe(document.body); // portal
		// Edit form prefilled from the row
		const uses = pop!.querySelector('.strip-menu-uses') as HTMLInputElement;
		const label = pop!.querySelector('.strip-menu-input:not(.strip-menu-uses)') as HTMLInputElement;
		const text = pop!.querySelector('.strip-menu-text') as HTMLTextAreaElement;
		expect(uses.value).toBe('207');
		expect(label.value).toBe('');
		expect(text.value).toBe('load project AIP, OCI');
		// Save fires onrename with the edited fields and closes the popup
		label.value = 'top loader';
		label.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		(pop!.querySelector('.strip-menu-save') as HTMLButtonElement).click();
		flushSync();
		expect(h.onrename).toHaveBeenCalledTimes(1);
		const [renamedRow, fields] = h.onrename.mock.calls[0] as unknown as [SuggestedPrompt, { uses: string; label: string; text: string }];
		expect(renamedRow.id).toBe(11);
		expect(fields.label).toBe('top loader');
		expect(fields.uses).toBe('207');
		expect(fields.text).toBe('load project AIP, OCI');
		expect(document.body.querySelector('.strip-menu-pop')).toBeNull(); // closed
		h.cleanup();
	});

	it('⋯ menu exclusivity: opening chip B closes chip A (menuForId swap)', async () => {
		const h = mountStrip();
		(h.menuBtns()[0] as HTMLButtonElement).click();
		flushSync();
		expect(document.body.querySelectorAll('.strip-menu-pop')).toHaveLength(1);
		(h.menuBtns()[1] as HTMLButtonElement).click();
		flushSync();
		const pops = document.body.querySelectorAll('.strip-menu-pop');
		expect(pops).toHaveLength(1); // still exactly one popup
		// And it is chip B's (fields prefilled with row 12's data)
		const text = pops[0].querySelector('.strip-menu-text') as HTMLTextAreaElement;
		expect(text.value).toContain('feature spec');
		h.cleanup();
	});

	it('Delete fires ondelete with the row and closes the popup', () => {
		const h = mountStrip();
		(h.menuBtns()[0] as HTMLButtonElement).click();
		flushSync();
		(document.body.querySelector('.strip-menu-delete') as HTMLButtonElement).click();
		flushSync();
		expect(h.ondelete).toHaveBeenCalledTimes(1);
		expect((h.ondelete.mock.calls[0] as unknown[])[0]).toMatchObject({ id: 11 });
		expect(document.body.querySelector('.strip-menu-pop')).toBeNull();
		h.cleanup();
	});

	it('Esc in the popup closes it and fires onclose (host refocuses textarea)', () => {
		const h = mountStrip();
		(h.menuBtns()[0] as HTMLButtonElement).click();
		flushSync();
		const pop = document.body.querySelector('.strip-menu-pop') as HTMLDivElement;
		pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(h.onclose).toHaveBeenCalledTimes(1);
		expect(document.body.querySelector('.strip-menu-pop')).toBeNull();
		h.cleanup();
	});
});

describe('SuggestStrip — highlight fragments (F4)', () => {
	it('live query marks the matched fragment in a .hl span', () => {
		const h = mountStrip({ query: '?load' });
		const hl = h.target.querySelector('.strip-pick .hl');
		expect(hl).not.toBeNull();
		expect(hl!.textContent).toBe('load');
		h.cleanup();
	});

	it('no query → no .hl spans (plain label)', () => {
		const h = mountStrip({ query: '' });
		expect(h.target.querySelectorAll('.strip-pick .hl')).toHaveLength(0);
		h.cleanup();
	});
});

// ── Prompt Macro (2026-08-29, task 2.1-T): run mode + the ⏯ Step button ──

describe('SuggestStrip — run mode + Step button (Prompt Macro D10)', () => {
	it('mode=run renders a ⏯ Step button per row; find mode renders none', () => {
		const find = mountStrip();
		expect(find.target.querySelectorAll('.strip-step-btn')).toHaveLength(0);
		find.cleanup();
		const onstep = vi.fn();
		const run = mountStrip({ mode: 'run', onstep });
		const steps = run.target.querySelectorAll('.strip-step-btn');
		expect(steps).toHaveLength(2); // one per row
		(steps[1] as HTMLButtonElement).click();
		flushSync();
		expect(onstep).toHaveBeenCalledWith(1);
		run.cleanup();
	});

	it('Step without onstep (prop absent): no buttons, rows still render', () => {
		const h = mountStrip({ mode: 'run' });
		expect(h.target.querySelectorAll('.strip-step-btn')).toHaveLength(0);
		expect(h.pickButtons()).toHaveLength(2);
		h.cleanup();
	});

	it('Step click does not fire pick (stopPropagation — step is the other start)', () => {
		const onstep = vi.fn();
		const h = mountStrip({ mode: 'run', onstep });
		(h.target.querySelectorAll('.strip-step-btn')[0] as HTMLButtonElement).click();
		flushSync();
		expect(h.onpick).not.toHaveBeenCalled();
		h.cleanup();
	});
});
