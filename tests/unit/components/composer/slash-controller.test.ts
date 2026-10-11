import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { SlashController } from '../../../../src/lib/components/composer/controller/slash-controller.svelte';
import type { SlashDirectory } from '../../../../src/lib/services/chat/slash-directory.svelte';
import { DraftBox } from './_draft-box.svelte';

/** Direct unit home for the slash machine (Tasks.md 2.1-T). */

const CATALOG: SlashDirectory = {
	state: 'ready',
	commands: [
		{ name: 'compact', input: { hint: 'tokens' } },
		{ name: 'permission', input: {} }
	],
	skills: [{ name: 'dsi-adr' }]
} as unknown as SlashDirectory;

function make(catalog: SlashDirectory | null = CATALOG, gates = { strip: false, helpV: false, helpS: false }) {
	const value = new DraftBox('');
	const ctl = new SlashController(
		{ getValue: () => value.get(), setValue: (v: string) => { value.set(v); flushSync(); } },
		() => catalog,
		{
			stripTriggerActive: () => gates.strip,
			helpVisible: () => gates.helpV,
			helpShape: () => gates.helpS
		},
		{
			focusInsert: () => {},
			focusExecute: () => {}
		}
	);
	return {
		ctl,
		set: (v: string) => {
			value.set(v);
			flushSync();
		}
	};
}

describe('SlashController', () => {
	it('parser stand-down: parser-owned drafts never open the menu', () => {
		const h = make();
		h.set('/permission');
		expect(h.ctl.open).toBe(false);
		h.set('/new');
		expect(h.ctl.open).toBe(false);
		h.set('/nope');
		expect(h.ctl.open).toBe(true);
	});

	it('cross-surface gates: strip trigger or help shape keeps the menu closed', () => {
		const h = make(CATALOG, { strip: true, helpV: false, helpS: false });
		h.set('/nope');
		expect(h.ctl.open).toBe(false);
		const h2 = make(CATALOG, { strip: false, helpV: true, helpS: true });
		h2.set('/nope');
		expect(h2.ctl.open).toBe(false);
	});

	it('rows: composite over gestures+commands+skills; empty while catalog not ready', () => {
		const h = make();
		h.set('/');
		const kinds = new Set(h.ctl.rows.map((r) => r.kind));
		expect(kinds).toEqual(new Set(['gesture', 'command', 'skill'])); // all three sections composite
		const idle = make({ state: 'idle', commands: [], skills: [] } as unknown as SlashDirectory);
		idle.set('/');
		expect(idle.ctl.rows.length).toBe(0); // loading rows never intercept
	});

	it('Esc memoizes the exact draft; a LONGER draft re-arms; trigger gone clears', () => {
		const h = make();
		h.set('/nope');
		h.ctl.memoize();
		expect(h.ctl.open).toBe(false);
		h.set('/nopeX');
		expect(h.ctl.open).toBe(true); // fresh intent unlocks
		h.set('plain');
		expect(h.ctl.trigger).toBe(false); // memo cleared with the trigger
	});

	it('insert pick lands the seed as the draft and memo-closes (two-press rule)', () => {
		let fired = '';
		const value = new DraftBox('');
		const ctl = new SlashController(
			{ getValue: () => value.get(), setValue: (v: string) => { value.set(v); flushSync(); } },
			() => CATALOG,
			{ stripTriggerActive: () => false, helpVisible: () => false, helpShape: () => false },
			{ focusInsert: () => {}, focusExecute: () => {}, onpickskill: (n) => (fired = n) }
		);
		ctl.pickInsert('/dsi-adr ', () => fired);
		expect(value.get()).toBe('/dsi-adr ');
		expect(ctl.open).toBe(false); // memo-closed on the new draft
	});

	it('execute pick clears only on an ADMITTED execution (BC-A3)', async () => {
		let admitted = true;
		const value = new DraftBox('/compact 5');
		const ctl = new SlashController(
			{ getValue: () => value.get(), setValue: (v: string) => { value.set(v); flushSync(); } },
			() => CATALOG,
			{ stripTriggerActive: () => false, helpVisible: () => false, helpShape: () => false },
			{
				focusInsert: () => {},
				focusExecute: () => {},
				onpickcommand: async () => {
					return admitted;
				}
			}
		);
		// the verbatim-draft rule: first token names the row, remainder rides
		await ctl.pickExecute('compact');
		expect(value.get()).toBe('');
		// a refused execution keeps the draft and memo-closes
		admitted = false;
		value.set('/comp 5');
		await ctl.pickExecute('compact');
		expect(value.get()).toBe('/comp 5'); // canonical name + raw remainder rode the line
	});
});
