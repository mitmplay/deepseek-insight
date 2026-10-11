import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { DraftBox } from './_draft-box.svelte';
import { HelpController } from '../../../../src/lib/components/composer/controller/help-controller.svelte';
import type { SlashDirectory } from '../../../../src/lib/services/chat/slash-directory.svelte';

/** Direct unit home for the help machine (Tasks.md 1.1-T): the same
 *  behaviors the component suite pins through the front door, asserted
 *  from the inside — no rendered composer needed (ADR-0020 §7 gains). */

function make(catalog: SlashDirectory | null = null) {
	// Box = reactive draft stand-in for the composer\'s $state value — the
	// controller\'s effect must track it exactly like the real draft.
	const value = new DraftBox('');
	return {
		ctl: new HelpController({ getValue: () => value.get() }, () => catalog),
		// flushSync settles the constructor\'s $effect.root (async scheduler)
		set: (v: string) => {
			value.set(v);
			flushSync();
		}
	};
}

describe('HelpController', () => {
	it('a gesture question (/new ?) opens the card; plain text does not', () => {
		const h = make();
		expect(h.ctl.visible).toBe(false);
		expect(h.ctl.handles()).toBe(false);
		h.set('/new ?');
		expect(h.ctl.visible).toBe(true);
		expect(h.ctl.handles()).toBe(true);
		expect(h.ctl.view).not.toBeNull();
	});

	it('Esc memoizes; a vanished shape re-arms the card', () => {
		const h = make();
		h.set('/new ?');
		const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
		expect(h.ctl.onKey(esc)).toBe(true);
		expect(esc.defaultPrevented).toBe(true);
		expect(h.ctl.visible).toBe(false);
		// shape still up, card hidden
		expect(h.ctl.handles()).toBe(true);
		// shape gone — the constructor effect re-arms
		h.set('hello');
		expect(h.ctl.visible).toBe(false);
		h.set('/new ?');
		expect(h.ctl.visible).toBe(true);
	});

	it('Enter on the card is answered, never a send-through; shift+Enter falls through', () => {
		const h = make();
		h.set('/permission ?');
		const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
		expect(h.ctl.onKey(enter)).toBe(true);
		expect(enter.defaultPrevented).toBe(true);
		const shift = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true });
		expect(h.ctl.onKey(shift)).toBe(false);
	});

	it('unrelated keys fall through the ladder', () => {
		const h = make();
		h.set('/new ?');
		expect(h.ctl.onKey(new KeyboardEvent('keydown', { key: 'a' }))).toBe(false);
	});

	it('an UNRESOLVED ? still owns its keys (shape); the view stays null', () => {
		// command-help.ts helpQuery: the shape is matched BEFORE the catalog
		// resolves — "the shape owns its keys even while the catalog is still
		// loading" (the pre-move behavior, component suite BC). The card\'s
		// absence is the honest answer; the LADDER ownership is not.
		const h = make(null);
		h.set('/nope ?');
		expect(h.ctl.handles()).toBe(true);
		expect(h.ctl.view).toBeNull();
	});
});
