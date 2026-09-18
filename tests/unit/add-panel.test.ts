/**
 * AddPanel unit tests — the tray's paste-add field mounted directly
 * (panels-row.test.ts exercises it only through the ControlBarHarness
 * tray, whose Enter keydown never reaches the submit handler).
 *
 * Pins the two-verbs-over-one-input contract:
 *  - a WHITESPACE-only Add submit early-returns: no registry fire, the
 *    junk text stays in the field (the floor never sees it)
 *  - Add (form submit) fires addPanelFromSidebar with the TRIMMED id
 *    and clears the field; Rplc (click only) fires replaceSelectedFromRegistry
 *    the same way
 *  - both verbs stay no-op-safe when the floor is not mounted
 *    (unregistered registry slots), and the field still clears
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AddPanel from '$lib/components/panels/control-bar/AddPanel.svelte';
import {
	addPanelFromSidebar,
	registerAddPanel,
	registerReplaceSelected,
	type PanelAddRequest
} from '$lib/services/panels/panel-registry';

function mountAddPanel() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(AddPanel, { target });
	flushSync();
	const input = target.querySelector('[data-testid="controlbar-add-input"]') as HTMLInputElement;
	const form = input.form as HTMLFormElement;
	/** Types into the field the way the browser does (bind:value input event). */
	const type = (text: string): void => {
		input.value = text;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
	};
	const submit = (): void => {
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		flushSync();
	};
	const clickReplace = (): void => {
		(target.querySelector('[data-testid="controlbar-replace-submit"]') as HTMLButtonElement).click();
		flushSync();
	};
	return { target, instance, input, type, submit, clickReplace };
}

afterEach(() => {
	document.body.innerHTML = '';
	registerAddPanel(null);
	registerReplaceSelected(null);
});

// ── Loadinjected W4 4.3-T — the floor seam the executor and the shelf ──
// button both write through (ADR D6: ONE write path to the floor).

describe('the injected-doc floor seam (4.3-T)', () => {
	it('the executor’s --add request shape flows through the shared registry seam', () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((request) => seen.push(request));
		expect(
			addPanelFromSidebar({
				kind: 'injected-doc',
				sourceSessionId: 'session-1',
				displayPath: 'AGENTS.md',
				afterSessionId: 'session-1'
			})
		).toBe(true);
		expect(seen).toEqual([
			{
				kind: 'injected-doc',
				sourceSessionId: 'session-1',
				displayPath: 'AGENTS.md',
				afterSessionId: 'session-1'
			}
		]);
	});

	it('the seam stays no-op-safe when the floor is not mounted (the registry contract)', () => {
		expect(
			addPanelFromSidebar({ kind: 'injected-doc', sourceSessionId: 's', displayPath: 'd' })
		).toBe(false);
	});
});

describe('AddPanel — whitespace-only input never reaches the floor', () => {
	it('an Add submit on whitespace-only text fires nothing and keeps the text', () => {
		const added: string[] = [];
		registerAddPanel((request) => {
			if (
				request.kind !== 'prompt-manager' &&
				request.kind !== 'settings-editor' &&
				request.kind !== 'injected-doc'
			)
				added.push(request.sessionId);
		});
		const { instance, input, type, submit } = mountAddPanel();
		type('   ');
		submit();
		expect(added).toEqual([]);
		expect(input.value).toBe('   '); // early return — no clear, the operator keeps typing
		unmount(instance);
	});

	it('a Rplc click on whitespace-only text fires nothing', () => {
		const replaced: string[] = [];
		registerReplaceSelected((request) => {
			if (
				request.kind !== 'prompt-manager' &&
				request.kind !== 'settings-editor' &&
				request.kind !== 'injected-doc'
			)
				replaced.push(request.sessionId);
		});
		const { instance, type, clickReplace } = mountAddPanel();
		type(' \t ');
		clickReplace();
		expect(replaced).toEqual([]);
		unmount(instance);
	});
});

describe('AddPanel — the two verbs fire trimmed ids through the registry', () => {
	it('Add submits the trimmed id with no preset and clears the field', () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((request) => seen.push({ ...request }));
		const { instance, input, type, submit } = mountAddPanel();
		type('  session-42  ');
		submit();
		expect(seen).toEqual([{ sessionId: 'session-42', agentPreset: null }]);
		expect(input.value).toBe('');
		unmount(instance);
	});

	it('Rplc clicks the trimmed id into replaceSelectedFromRegistry and clears the field', () => {
		const seen: PanelAddRequest[] = [];
		registerReplaceSelected((request) => seen.push({ ...request }));
		const { instance, input, type, clickReplace } = mountAddPanel();
		type('  session-99  ');
		clickReplace();
		expect(seen).toEqual([{ sessionId: 'session-99', agentPreset: null }]);
		expect(input.value).toBe('');
		unmount(instance);
	});
});

describe('AddPanel — unmounted floor is a graceful no-op', () => {
	it('both verbs clear the field without throwing when no handler is registered', () => {
		const { instance, input, type, submit, clickReplace } = mountAddPanel();
		type('session-13');
		expect(() => submit()).not.toThrow();
		expect(input.value).toBe('');
		type('session-14');
		expect(() => clickReplace()).not.toThrow();
		expect(input.value).toBe('');
		unmount(instance);
	});
});
