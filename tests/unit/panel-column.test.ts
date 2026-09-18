/**
 * PanelColumn unit tests — one panel's fixed-width column shell.
 *
 * Component-direct mount (panels-row.test.ts pins the shell's static
 * render; this suite pins the 2026-08-25 selection-follow handlers the
 * shell carries):
 *
 *  - pointerdown anywhere inside the column activates (selects) the
 *    panel through the onactivate prop
 *  - focusin (keyboard arrival) activates the same way
 *  - onactivate is OPTIONAL — both handlers stay no-op-safe without it
 *
 * The loupe trigger (The Panel Loupe ADR D1; widened by The Loupe for
 * Every Panel, 2026-09-08 — Alt modifier, every kind):
 *  - Alt+Click on the column BODY fires onloupe once — on the click
 *    phase, after the pointerdown activation (D6: one gesture, focus first)
 *  - a plain click fires nothing new, and Shift+Click no longer does
 *  - Alt+Click on a control (button, input, header close) never fires
 *    it — ONE closest() exclusion at the column handler
 *  - without the onloupe prop the Alt+Click is a safe no-op
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PanelColumn from '$lib/components/panels/PanelColumn.svelte';
import type { DsiPanelEntry } from '$lib/types';

/** Snippet per mount — the repo pattern (panels-row.test.ts), with a
 *  single-element render body (createRawSnippet's contract). */
function bodySnippet() {
	return createRawSnippet(() => ({ render: () => '<div>panel body</div>' }));
}

function entry(id: string, sessionId: string, width: number): DsiPanelEntry {
	return { id, kind: 'conversation', sessionId, agentPreset: null, width };
}

function mountColumn(props: {
	panel?: DsiPanelEntry;
	index?: number;
	selected?: boolean;
	canMoveLeft?: boolean;
	onactivate?: () => void;
	onloupe?: () => void;
	body?: ReturnType<typeof bodySnippet>;
}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PanelColumn, {
		target,
		props: {
			panel: props.panel ?? entry('p1', 's-1', 730),
			index: props.index ?? 0,
			selected: props.selected ?? false,
			canMoveLeft: props.canMoveLeft ?? false,
			onremove: vi.fn(),
			...(props.onactivate !== undefined ? { onactivate: props.onactivate } : {}),
			...(props.onloupe !== undefined ? { onloupe: props.onloupe } : {}),
			children: props.body ?? bodySnippet()
		}
	});
	flushSync();
	return { target, instance };
}

const columnOf = (target: HTMLElement): HTMLElement =>
	target.querySelector('[data-testid="panel-column"]') as HTMLElement;

afterEach(() => {
	document.body.innerHTML = '';
});

describe('PanelColumn — selection follow (pointerdown / focusin)', () => {
	it('pointerdown inside the column fires onactivate (interacting selects the panel)', () => {
		const onactivate = vi.fn();
		const { target, instance } = mountColumn({ onactivate });
		const column = target.querySelector('[data-testid="panel-column"]') as HTMLElement;
		column.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(onactivate).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('focusin inside the column fires onactivate too (keyboard parity)', () => {
		const onactivate = vi.fn();
		const { target, instance } = mountColumn({ onactivate });
		const column = target.querySelector('[data-testid="panel-column"]') as HTMLElement;
		column.dispatchEvent(new Event('focusin', { bubbles: true }));
		expect(onactivate).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('both handlers fire per event — pointer then focus in one interaction', () => {
		const onactivate = vi.fn();
		const { target, instance } = mountColumn({ onactivate });
		const column = target.querySelector('[data-testid="panel-column"]') as HTMLElement;
		column.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		column.dispatchEvent(new Event('focusin', { bubbles: true }));
		expect(onactivate).toHaveBeenCalledTimes(2);
		unmount(instance);
	});

	it('without the optional onactivate prop both handlers stay no-op-safe', () => {
		const { target, instance } = mountColumn({}); // no onactivate
		const column = target.querySelector('[data-testid="panel-column"]') as HTMLElement;
		expect(() => {
			column.dispatchEvent(new Event('pointerdown', { bubbles: true }));
			column.dispatchEvent(new Event('focusin', { bubbles: true }));
		}).not.toThrow();
		unmount(instance);
	});
});

describe('PanelColumn — shell contract (re-pinned beside the handlers)', () => {
	it('carries the panel identity, fixed width, selection class, and the gutter sibling', () => {
		const { target, instance } = mountColumn({
			panel: entry('p7', 's-seven', 480),
			index: 2,
			selected: true
		});
		const column = target.querySelector('[data-testid="panel-column"]') as HTMLElement;
		expect(column.getAttribute('data-panel-id')).toBe('p7');
		expect(column.getAttribute('data-session-id')).toBe('s-seven');
		expect(column.style.width).toBe('480px');
		expect(column.classList.contains('selected')).toBe(true);
		// Every panel's trailing gutter renders as a sibling.
		expect(target.querySelector('[data-testid="panel-gutter-2"]')).not.toBeNull();
		unmount(instance);
	});

	it('unselected columns carry no selection ring class', () => {
		const { target, instance } = mountColumn({ selected: false });
		expect(
			(target.querySelector('[data-testid="panel-column"]') as HTMLElement).classList.contains(
				'selected'
			)
		).toBe(false);
		unmount(instance);
	});
});

describe('PanelColumn — the loupe trigger (Panel Loupe D1)', () => {
	it('Alt+Click on the column body fires onloupe once; the pointerdown activation rode the same gesture', () => {
		const onactivate = vi.fn();
		const onloupe = vi.fn();
		const { target, instance } = mountColumn({ onactivate, onloupe });
		const column = columnOf(target);
		column.dispatchEvent(new Event('pointerdown', { bubbles: true })); // D6: focus first
		column.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
		expect(onloupe).toHaveBeenCalledTimes(1);
		expect(onactivate).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('a plain click fires nothing new; pointerdown still activates', () => {
		const onactivate = vi.fn();
		const onloupe = vi.fn();
		const { target, instance } = mountColumn({ onactivate, onloupe });
		const column = columnOf(target);
		column.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(onloupe).not.toHaveBeenCalled();
		column.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(onactivate).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('Alt+Click on a button stub, an input, and the header close each fire NO onloupe', () => {
		const onloupe = vi.fn();
		const controls = createRawSnippet(() => ({
			// Single-element render body (createRawSnippet's contract) — the
			// two control probes ride inside one wrapper div.
			render: () =>
				'<div><button data-testid="stub-control">go</button><input data-testid="stub-input" /></div>'
		}));
		const { target, instance } = mountColumn({ onloupe, canMoveLeft: true, body: controls });
		const altClick = (el: Element): void => {
			el.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
		};
		altClick(target.querySelector('[data-testid="stub-control"]') as Element);
		altClick(target.querySelector('[data-testid="stub-input"]') as Element);
		altClick(target.querySelector('[data-testid="panel-close"]') as Element);
		altClick(target.querySelector('[data-testid="panel-move-left"]') as Element);
		expect(onloupe).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('without the onloupe prop the Alt+Click is a safe no-op', () => {
		const { target, instance } = mountColumn({}); // no onloupe
		expect(() => {
			columnOf(target).dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
		}).not.toThrow();
		unmount(instance);
	});
});

// ── W6 6.1-T, widened — the D9 kind gate is LIFTED (The Loupe for
// Every Panel, 2026-09-08): every kind opens the lens, the modifier
// moved to Alt, and the old Shift trigger is retired. ─────────
describe('PanelColumn — every kind opens the lens (W6 6.1-T widened)', () => {
	function managerEntry(id: string, width: number): DsiPanelEntry {
		return { id, kind: 'prompt-manager', width };
	}

	it('Alt+Click on a MANAGER body fires onloupe (the D9 gate is lifted)', () => {
		const onloupe = vi.fn();
		const { target, instance } = mountColumn({
			panel: managerEntry('m1', 500),
			onloupe
		});
		try {
			const body = target.querySelector('.body') as HTMLElement;
			body.dispatchEvent(
				new MouseEvent('click', { altKey: true, bubbles: true })
			);
			flushSync();
			expect(onloupe).toHaveBeenCalledTimes(1);
		} finally {
			unmount(instance);
		}
	});

	it('Alt+Click on a CONVERSATION body still fires onloupe (unchanged)', () => {
		const onloupe = vi.fn();
		const { target, instance } = mountColumn({
			panel: entry('p1', 's1', 500),
			onloupe
		});
		try {
			const body = target.querySelector('.body') as HTMLElement;
			body.dispatchEvent(
				new MouseEvent('click', { altKey: true, bubbles: true })
			);
			flushSync();
			expect(onloupe).toHaveBeenCalledTimes(1);
		} finally {
			unmount(instance);
		}
	});

	it('Shift+Click fires NO onloupe — the modifier moved to Alt', () => {
		const onloupe = vi.fn();
		const a = mountColumn({ panel: managerEntry('m1', 500), onloupe });
		const b = mountColumn({ panel: entry('p1', 's1', 500), onloupe });
		try {
			for (const t of [a.target, b.target]) {
				(t.querySelector('.body') as HTMLElement).dispatchEvent(
					new MouseEvent('click', { shiftKey: true, bubbles: true })
				);
			}
			flushSync();
			expect(onloupe).not.toHaveBeenCalled();
		} finally {
			unmount(a.instance);
			unmount(b.instance);
		}
	});

	it('the manager header variant: title label, no copy-id button, no session id', () => {
		const { target, instance } = mountColumn({ panel: managerEntry('m1', 500) });
		try {
			const header = target.querySelector('[data-testid="panel-header"]') as HTMLElement;
			expect(header.getAttribute('title')).toBe('Prompt Manager');
			expect(header.textContent).toContain('Prompt Manager');
			expect(target.querySelector('[data-testid="panel-header-copy-id"]')).toBeNull();
			expect(header.textContent).not.toContain('session');
			// Move chevrons + close stay live (positional verbs, D10).
			expect(target.querySelector('[data-testid="panel-close"]')).not.toBeNull();
		} finally {
			unmount(instance);
		}
	});

	it('the conversation header renders the id + copy button verbatim (no variant drift)', () => {
		const { target, instance } = mountColumn({ panel: entry('p1', 's-one', 500) });
		try {
			const header = target.querySelector('[data-testid="panel-header"]') as HTMLElement;
			expect(header.textContent).toContain('s-one');
			expect(target.querySelector('[data-testid="panel-header-copy-id"]')).not.toBeNull();
		} finally {
			unmount(instance);
		}
	});
});

// ── Settings Panel W4 4.3-T — the settings-editor column (2026-09-07 ADR D3) ──

describe('PanelColumn — the settings-editor branch (W4 4.3-T)', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('renders the target-pinned header label', () => {
		const dsi: DsiPanelEntry = { id: 'p1', kind: 'settings-editor', target: 'dsi', width: 600 };
		const dsh: DsiPanelEntry = { id: 'p2', kind: 'settings-editor', target: 'dsh', width: 600 };
		const a = mountColumn({ panel: dsi });
		const b = mountColumn({ panel: dsh });
		flushSync();
		const labels = [a.target, b.target].map(
			(t) => t.querySelector('[data-testid="panel-label"]')?.textContent ?? ''
		);
		// If the header carries no testid, fall back to text presence.
		expect(a.target.textContent).toContain('DSI Settings');
		expect(b.target.textContent).toContain('DSH Settings');
		expect(labels[0] === '' || labels[0].includes('DSI Settings')).toBe(true);
		unmount(a.instance);
		unmount(b.instance);
		a.target.remove();
		b.target.remove();
	});

	it('Alt+Click (the loupe trigger) opens the lens on a settings panel too', () => {
		const onloupe = vi.fn();
		const panel: DsiPanelEntry = { id: 'p1', kind: 'settings-editor', target: 'dsh', width: 600 };
		const { target, instance } = mountColumn({ panel, onloupe });
		const col = target.querySelector('[data-testid="panel-column"]') as Element;
		col.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
		flushSync();
		expect(onloupe).toHaveBeenCalledTimes(1);
		unmount(instance);
		target.remove();
	});

	it('Alt+Click opens the lens on an injected-doc panel (kind gate lifted)', () => {
		const onloupe = vi.fn();
		const panel: DsiPanelEntry = {
			id: 'p1',
			kind: 'injected-doc',
			sourceSessionId: 's-src',
			displayPath: 'docs/note.md',
			width: 600
		};
		const { target, instance } = mountColumn({ panel, onloupe });
		const col = target.querySelector('[data-testid="panel-column"]') as Element;
		col.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
		flushSync();
		expect(onloupe).toHaveBeenCalledTimes(1);
		unmount(instance);
		target.remove();
	});
});
