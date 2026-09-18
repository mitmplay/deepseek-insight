/**
 * PromptInput × Slash Menu (task 2.2-T): the trigger grammar (a `/`
 * draft parseCommand DECLINES — parser stand-down, Resolved decision 6),
 * the row-gated keyboard guard (Tab/Enter/arrows only over matching rows,
 * else Enter falls through to submit), kind-aware picks (hint-less
 * command executes via the BC-A3 boolean, hint command and skill insert
 * `/name ` with the caret after the token — the two-press rule; Tab
 * accepts exactly like Enter, Shift+Tab cycles back), the
 * DSI gesture section (ADR §1.1 layer A: /new + @mention always list
 * first, picks are insert-only seeds), the strip's Esc memo + longer-
 * query unlock, IME pass-through, the onslashopen bridge cadence, and
 * draft persistence across an insert.
 *
 * The catalog rides props (the bridge contract) — no fetch belongs to
 * the menu; the fetch mock only serves the app-config singleton stall.
 */
import { mount, unmount, flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PromptInput from '$lib/components/chat/PromptInput.svelte';
import type { SlashDirectory } from '$lib/services/chat/slash-directory.svelte';

const SID = 'session-slash';

function cmd(name: string, hint?: string) {
	return hint === undefined
		? { name, description: `${name} — host-side` }
		: { name, description: `${name} — host-side`, input: { hint } };
}
function skill(name: string, modelInvocable = true) {
	return { name, description: `${name} — skill`, modelInvocable };
}

const READY: SlashDirectory = {
	commands: [cmd('compact'), cmd('plan', '<goal>')],
	skills: [skill('dsh-doc'), skill('mux', false)],
	state: 'ready'
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	// The strip's finder (the '?' parity case) needs prompt rows; the
	// app-config singleton fetch stalls (documented defaults hold).
	fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input.toString();
		if (url.startsWith('/api/prompts?')) {
			return new Response(
				JSON.stringify({
					results: [
						{
							id: 1,
							label: null,
							text: 'load the project notes',
							use_count: 1,
							last_used_at: '2026-08-30T00:00:00.000Z'
						}
					]
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);
		}
		return new Promise<Response>(() => {});
	});
	vi.stubGlobal('fetch', fetchMock);
	localStorage.clear();
});

interface Harness {
	target: HTMLDivElement;
	textarea(): HTMLTextAreaElement;
	menu(): Element | null;
	rows(): Element[];
	gestureRows(): Element[];
	commandRows(): Element[];
	skillRows(): Element[];
	value(): string;
	cleanup(): void;
}

function mountMenu(
	handlers: {
		onsubmit?: (text: string) => boolean | Promise<boolean>;
		onpickcommand?: (line: string) => boolean | Promise<boolean>;
		onpickcommandwithhint?: (name: string) => void;
		onpickskill?: (name: string) => void;
		onslashopen?: () => void;
	},
	catalog: SlashDirectory | null = READY
): Harness {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(PromptInput, {
		target,
		props: {
			onsubmit: handlers.onsubmit ?? vi.fn(() => true),
			oncancel: () => {},
			isStreaming: false,
			sending: false,
			sessionId: SID,
			slashCatalog: catalog,
			onslashopen: handlers.onslashopen,
			onpickcommand: handlers.onpickcommand,
			onpickcommandwithhint: handlers.onpickcommandwithhint,
			onpickskill: handlers.onpickskill
		}
	});
	flushSync();
	const textarea = () =>
		target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
	return {
		target,
		textarea,
		menu: () => target.querySelector('[data-testid="slash-menu"]'),
		rows: () => Array.from(target.querySelectorAll('[role="option"]')),
		gestureRows: () => Array.from(target.querySelectorAll('[data-testid="slash-gesture-row"]')),
		commandRows: () => Array.from(target.querySelectorAll('[data-testid="slash-command-row"]')),
		skillRows: () => Array.from(target.querySelectorAll('[data-testid="slash-skill-row"]')),
		value: () => textarea().value,
		cleanup: () => {
			unmount(comp);
			target.remove();
		}
	};
}

/** Type into the textarea (value + input event, native-like). */
function type(h: Harness, text: string): void {
	const ta = h.textarea();
	ta.value = text;
	ta.selectionStart = ta.selectionEnd = text.length;
	ta.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

/** Dispatch a keydown on the textarea. */
function key(h: Harness, keyName: string, shift = false): KeyboardEvent {
	const ev = new KeyboardEvent('keydown', {
		key: keyName,
		shiftKey: shift,
		bubbles: true,
		cancelable: true
	});
	h.textarea().dispatchEvent(ev);
	flushSync();
	return ev;
}

async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
	// The suggest debounce is 120 ms on REAL timers (the suggest-file
	// convention) — the settle window must outlive it plus the mocked
	// fetch microtasks before the strip can render.
	await new Promise((resolve) => setTimeout(resolve, 250));
	flushSync();
}

describe('PromptInput × SlashMenu — trigger grammar', () => {
	it('"/" opens the menu (strip and help inactive) and fires the bridge', () => {
		const onslashopen = vi.fn();
		const h = mountMenu({ onslashopen });
		type(h, '/');
		expect(h.menu()).not.toBeNull();
		expect(h.target.querySelector('[data-testid="slash-gestures-label"]')).not.toBeNull();
		expect(h.target.querySelector('[data-testid="slash-commands-label"]')).not.toBeNull();
		expect(h.target.querySelector('[data-testid="slash-skills-label"]')).not.toBeNull();
		expect(onslashopen).toHaveBeenCalled();
		h.cleanup();
	});

	it("'?' and '!' keep their triggers — the strip wins, the menu never opens", async () => {
		const h = mountMenu({});
		type(h, '?load');
		await settle(); // the strip renders only after its debounced fetch lands
		expect(h.target.querySelector('[data-testid="suggest-strip"]')).not.toBeNull();
		expect(h.menu()).toBeNull();
		type(h, '!load');
		await settle();
		expect(h.target.querySelector('[data-testid="suggest-strip"]')).not.toBeNull();
		expect(h.menu()).toBeNull();
		h.cleanup();
	});

	it('parser stand-down: /permission and /new drafts never open the menu', () => {
		const h = mountMenu({});
		type(h, '/permission');
		expect(h.menu()).toBeNull();
		type(h, '/new @agent');
		expect(h.menu()).toBeNull();
		h.cleanup();
	});

	it('a failed catalog renders the error row; loading renders the loading row', () => {
		const h = mountMenu({}, { commands: [], skills: [], state: 'failed' });
		type(h, '/');
		expect(h.target.querySelector('[data-testid="slash-menu-error"]')).not.toBeNull();
		h.cleanup();
		const h2 = mountMenu(
			{},
			{ commands: [], skills: [], state: 'loading' }
		);
		type(h2, '/');
		expect(h2.target.querySelector('[data-testid="slash-menu-loading"]')).not.toBeNull();
		h2.cleanup();
	});
});

describe('PromptInput × SlashMenu — kind-aware picks', () => {
	it('clicking a hint-less command executes via onpickcommand with the canonical line and clears the draft on admit', async () => {
		const onpickcommand = vi.fn(async () => true);
		const onsubmit = vi.fn(async () => true);
		const h = mountMenu({ onpickcommand, onsubmit });
		type(h, '/comp');
		expect(h.commandRows()).toHaveLength(1); // filter narrowed to compact
		(h.commandRows()[0] as HTMLElement).click();
		flushSync();
		await settle();
		expect(onpickcommand).toHaveBeenCalledWith('/compact'); // canonical + remainder rule
		expect(onsubmit).not.toHaveBeenCalled(); // a pick never rides the submit path
		expect(h.value()).toBe(''); // admitted execution clears the draft
		expect(h.menu()).toBeNull();
		h.cleanup();
	});

	it('a kept draft (BC-A3 false) stays after a refused pick and the menu stays closed', async () => {
		const onpickcommand = vi.fn(async () => false);
		const h = mountMenu({ onpickcommand });
		type(h, '/comp');
		(h.commandRows()[0] as HTMLElement).click();
		flushSync();
		await settle();
		expect(h.value()).toBe('/comp'); // the draft is the operator's to fix
		expect(h.menu()).toBeNull(); // memo-closed — the honest note is on screen
		h.cleanup();
	});

	it('a hint command pick inserts "/name " with the caret after the token (press 2 sends)', async () => {
		const onpickcommandwithhint = vi.fn();
		const onsubmit = vi.fn(async () => true);
		const h = mountMenu({ onpickcommandwithhint, onsubmit });
		type(h, '/');
		(h.commandRows()[1] as HTMLElement).click(); // plan (hint row)
		flushSync();
		expect(onpickcommandwithhint).toHaveBeenCalledWith('plan');
		const ta = h.textarea();
		expect(h.value()).toBe('/plan ');
		expect(ta.selectionStart).toBe('/plan '.length); // caret after the token
		expect(onsubmit).not.toHaveBeenCalled(); // never auto-sent
		expect(h.menu()).toBeNull(); // memo-closed on the new draft
		// Press 2 — the operator's own Enter sends the inserted line.
		key(h, 'Enter');
		await settle();
		expect(onsubmit).toHaveBeenCalledWith('/plan', []);
		h.cleanup();
	});

	it('a skill pick inserts "/name " and the operator’s Enter sends it (two-press rule)', async () => {
		const onpickskill = vi.fn();
		const onsubmit = vi.fn(async () => true);
		const h = mountMenu({ onpickskill, onsubmit });
		type(h, '/');
		(h.skillRows()[0] as HTMLElement).click(); // dsh-doc
		flushSync();
		expect(onpickskill).toHaveBeenCalledWith('dsh-doc');
		expect(h.value()).toBe('/dsh-doc ');
		expect(h.textarea().selectionStart).toBe('/dsh-doc '.length);
		expect(onsubmit).not.toHaveBeenCalled();
		key(h, 'Enter');
		await settle();
		expect(onsubmit).toHaveBeenCalledWith('/dsh-doc', []);
		h.cleanup();
	});
});

describe('PromptInput × SlashMenu — DSI gesture rows (ADR §1.1 layer A)', () => {
	it('bare "/" lists the two client gestures FIRST, before host rows (ladder priority order)', () => {
		const h = mountMenu({});
		type(h, '/');
		expect(h.gestureRows()).toHaveLength(6); // /new + /workspace + /promptmanager + the two settings rows + @mention, always (/loadinjected retired 2026-09-17)
		expect(h.rows()[0]?.getAttribute('data-name')).toBe('new');
		expect(h.rows()[1]?.getAttribute('data-name')).toBe('workspace');
		expect(h.rows()[2]?.getAttribute('data-name')).toBe('promptmanager');
		expect(h.rows()[3]?.getAttribute('data-name')).toBe('dsisettings');
		expect(h.rows()[4]?.getAttribute('data-name')).toBe('dshsettings');
		expect(h.rows()[5]?.getAttribute('data-name')).toBe('@mention');
		expect(h.rows()[6]?.getAttribute('data-name')).toBe('compact'); // then the host catalog
		// The mention row renders verbatim — never re-prefixed with '/'.
		expect(h.gestureRows()[2]?.textContent).toContain('/promptmanager');
		expect(h.gestureRows()[5]?.textContent).toContain('@mention');
		h.cleanup();
	});

	it('a /new gesture pick seeds "/new " and never sends — the operator\'s Enter is press 2', async () => {
		const onsubmit = vi.fn(async () => true);
		const h = mountMenu({ onsubmit });
		type(h, '/n'); // partial draft — parseCommand declines, the menu opens
		// The matcher is substring-AND: the single letter 'n' hits every
		// gesture row (/new, /promptmanager, @mention), so the pick targets
		// the row by name.
		const rows = h.gestureRows();
		expect(rows).toHaveLength(6); // + the settings gestures, /workspace (2026-09-15); /loadinjected retired (2026-09-17)
		const newRow = rows.find((r) => r.getAttribute('data-name') === 'new') as HTMLElement;
		newRow.click();
		flushSync();
		expect(h.value()).toBe('/new '); // the seed, arguments are the operator's
		expect(h.textarea().selectionStart).toBe('/new '.length);
		expect(onsubmit).not.toHaveBeenCalled(); // the insert never rides the wire
		expect(h.menu()).toBeNull(); // memo-closed on the new draft
		key(h, 'Enter'); // press 2 — the ladder's first rung (parseCommand) owns it
		await settle();
		expect(onsubmit).toHaveBeenCalledWith('/new', []);
		h.cleanup();
	});

	it('the @mention pick seeds the "@session-" grammar the parser actually accepts', () => {
		const onsubmit = vi.fn(async () => true);
		const h = mountMenu({ onsubmit });
		type(h, '/');
		(h.gestureRows()[5] as HTMLElement).click(); // @mention (last row — /loadinjected retired 2026-09-17)
		flushSync();
		expect(h.value()).toBe('@session-'); // the uuid-tail scaffold
		expect(onsubmit).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('an EMPTY host catalog (subagent edge) still lists the client gestures', () => {
		const h = mountMenu({}, { commands: [], skills: [], state: 'ready' });
		type(h, '/');
		expect(h.gestureRows()).toHaveLength(6); // settings rows + /workspace (2026-09-15); /loadinjected retired (2026-09-17)
		expect(h.commandRows()).toHaveLength(0);
		expect(h.skillRows()).toHaveLength(0);
		h.cleanup();
	});

	it('loading and failed catalogs still render status rows only — no gesture rows', () => {
		const loading = mountMenu({}, { commands: [], skills: [], state: 'loading' });
		type(loading, '/');
		expect(loading.rows()).toHaveLength(0);
		loading.cleanup();
		const failed = mountMenu({}, { commands: [], skills: [], state: 'failed' });
		type(failed, '/');
		expect(failed.rows()).toHaveLength(0);
		failed.cleanup();
	});
});

describe('PromptInput × SlashMenu — the ? help shape stands the menu down', () => {
	it('"/plan ?" shows the host help card, never the menu, and asks the panel for the catalog', async () => {
		const onslashopen = vi.fn();
		const onsubmit = vi.fn(async () => true);
		const h = mountMenu({ onsubmit, onslashopen });
		type(h, '/plan ?');
		expect(h.menu()).toBeNull(); // a question is on the line — no menu
		const card = h.target.querySelector('[data-testid="command-help"]');
		expect(card).not.toBeNull();
		expect(card?.textContent).toContain('/plan <goal>');
		expect(onslashopen).toHaveBeenCalled(); // the card fetches what it reads
		const ev = key(h, 'Enter');
		await settle();
		expect(ev.defaultPrevented).toBe(true);
		expect(onsubmit).not.toHaveBeenCalled(); // a ? line never rides the wire
		h.cleanup();
	});

	it('an unresolved ? draft (no catalog) resolves to silence — and Enter is still swallowed', async () => {
		const onsubmit = vi.fn(async () => true);
		const h = mountMenu({ onsubmit }, null); // slashCatalog null
		type(h, '/plan ?');
		expect(h.menu()).toBeNull();
		expect(h.target.querySelector('[data-testid="command-help"]')).toBeNull();
		const ev = key(h, 'Enter');
		await settle();
		expect(ev.defaultPrevented).toBe(true);
		expect(onsubmit).not.toHaveBeenCalled();
		h.cleanup();
	});
});

describe('PromptInput × SlashMenu — row-gated keyboard guard', () => {
	it('Enter picks the highlighted row; arrows cycle over matching rows', async () => {
		const onpickcommand = vi.fn(async () => true);
		const onpickcommandwithhint = vi.fn();
		const h = mountMenu({ onpickcommand, onpickcommandwithhint });
		type(h, '/');
		expect(h.rows()).toHaveLength(10); // 6 gestures + 2 commands + 2 skills (/loadinjected retired 2026-09-17)
		key(h, 'ArrowDown'); // 1 → /workspace
		key(h, 'ArrowDown'); // 2 → /promptmanager
		key(h, 'ArrowDown'); // 3 → /dsisettings
		key(h, 'ArrowDown'); // 4 → /dshsettings
		key(h, 'ArrowDown'); // 5 → @mention
		key(h, 'ArrowDown'); // 6 → compact
		key(h, 'ArrowDown'); // 7 → plan (hint)
		key(h, 'Enter');
		await settle();
		expect(onpickcommandwithhint).toHaveBeenCalledWith('plan');
		expect(onpickcommand).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('Enter on the highlighted gesture row (index 0) seeds the draft', async () => {
		const onsubmit = vi.fn(async () => true);
		const h = mountMenu({ onsubmit });
		type(h, '/');
		key(h, 'Enter'); // index 0 = /new
		flushSync();
		expect(h.value()).toBe('/new ');
		expect(onsubmit).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('Tab accepts exactly like Enter: the highlighted /new row fills the draft (never sends)', async () => {
		const onsubmit = vi.fn(async () => true);
		const h = mountMenu({ onsubmit });
		type(h, '/');
		const ev = key(h, 'Tab'); // index 0 = /new — the user's journey
		flushSync();
		expect(ev.defaultPrevented).toBe(true); // focus never escapes the composer
		expect(h.value()).toBe('/new '); // the seed — arguments are the operator's
		expect(onsubmit).not.toHaveBeenCalled(); // insert-only, never the wire
		expect(h.menu()).toBeNull(); // memo-closed; the operator's Enter is press 2
		key(h, 'Enter');
		await settle();
		expect(onsubmit).toHaveBeenCalledWith('/new', []);
		h.cleanup();
	});

	it('Tab on a hint command row inserts "/name " (Tab ≡ Enter for every kind)', async () => {
		const onpickcommandwithhint = vi.fn();
		const onsubmit = vi.fn(async () => true);
		const h = mountMenu({ onpickcommandwithhint, onsubmit });
		type(h, '/');
		key(h, 'ArrowDown'); // 1 → /workspace
		key(h, 'ArrowDown'); // 2 → /promptmanager
		key(h, 'ArrowDown'); // 3 → /dsisettings
		key(h, 'ArrowDown'); // 4 → /dshsettings
		key(h, 'ArrowDown'); // 5 → @mention
		key(h, 'ArrowDown'); // 6 → compact (no hint)
		key(h, 'ArrowDown'); // 7 → plan (hint)
		key(h, 'Tab');
		flushSync();
		expect(onpickcommandwithhint).toHaveBeenCalledWith('plan');
		expect(h.value()).toBe('/plan ');
		expect(onsubmit).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('Shift+Tab cycles the highlight backward (strip parity)', async () => {
		const onsubmit = vi.fn(async () => true);
		const h = mountMenu({ onsubmit });
		type(h, '/');
		key(h, 'ArrowDown'); // 1 → /promptmanager
		key(h, 'Tab', true); // Shift+Tab → back to 0 (/new)
		key(h, 'Enter');
		flushSync();
		expect(h.value()).toBe('/new ');
		h.cleanup();
	});

	it('Tab with ZERO matching rows falls through (no interception, no focus steal)', () => {
		const h = mountMenu({});
		type(h, '/nope');
		expect(h.rows()).toHaveLength(0);
		const ev = key(h, 'Tab');
		expect(ev.defaultPrevented).toBe(false); // the browser's Tab is untouched
		h.cleanup();
	});

	it('Enter with ZERO matching rows falls through to submit and the menu closes', async () => {
		const onsubmit = vi.fn(async () => true);
		const onpickcommand = vi.fn();
		const h = mountMenu({ onsubmit, onpickcommand });
		type(h, '/nope');
		expect(h.menu()).not.toBeNull(); // open — parser declined
		expect(h.rows()).toHaveLength(0); // …but nothing matches
		const ev = key(h, 'Enter');
		await settle();
		expect(ev.defaultPrevented).toBe(true); // submit's own preventDefault
		expect(onsubmit).toHaveBeenCalledWith('/nope', []);
		expect(onpickcommand).not.toHaveBeenCalled();
		expect(h.menu()).toBeNull(); // draft cleared → trigger gone
		h.cleanup();
	});

	it('Esc dismisses; the exact draft stays dismissed; a longer draft re-arms', () => {
		const h = mountMenu({});
		type(h, '/');
		expect(h.menu()).not.toBeNull();
		key(h, 'Escape');
		expect(h.menu()).toBeNull();
		type(h, '/'); // same query — memo holds
		expect(h.menu()).toBeNull();
		type(h, '/c'); // longer — fresh intent
		expect(h.menu()).not.toBeNull();
		h.cleanup();
	});

	it('IME composition passes through: the menu never intercepts while composing', () => {
		const onpickcommand = vi.fn();
		const h = mountMenu({ onpickcommand });
		type(h, '/');
		expect(h.menu()).not.toBeNull();
		h.textarea().dispatchEvent(new Event('compositionstart', { bubbles: true }));
		flushSync();
		key(h, 'Enter');
		// The menu owns NO interception during composition: no pick, no
		// dismiss by the MENU (the shipped submit branch below the guard
		// is not this feature's surface — strip-guard parity is pinned).
		expect(onpickcommand).not.toHaveBeenCalled();
		h.textarea().dispatchEvent(new Event('compositionend', { bubbles: true }));
		flushSync();
		h.cleanup();
	});
});

describe('PromptInput × SlashMenu — the bridge + draft persistence', () => {
	it('onslashopen fires on open and per query move while open — never while closed', () => {
		const onslashopen = vi.fn();
		const h = mountMenu({ onslashopen });
		expect(onslashopen).not.toHaveBeenCalled(); // closed/mount — nothing woken
		type(h, '/');
		const afterOpen = onslashopen.mock.calls.length;
		expect(afterOpen).toBeGreaterThanOrEqual(1);
		type(h, '/c');
		expect(onslashopen.mock.calls.length).toBeGreaterThan(afterOpen);
		const afterQuery = onslashopen.mock.calls.length;
		type(h, 'ordinary');
		expect(onslashopen.mock.calls.length).toBe(afterQuery); // menu closed — silent
		h.cleanup();
	});

	it('draft persistence survives a pick insert (save + restore round-trip)', async () => {
		vi.useFakeTimers();
		try {
			const onpickskill = vi.fn();
			const h = mountMenu({ onpickskill });
			type(h, '/');
			(h.skillRows()[0] as HTMLElement).click();
			flushSync();
			expect(h.value()).toBe('/dsh-doc ');
			await vi.advanceTimersByTimeAsync(400); // draft debounce
			flushSync();
			const stored = localStorage.getItem(`dsi-draft_${SID}`);
			expect(stored).not.toBeNull();
			expect(JSON.parse(stored as string)).toMatchObject({ text: '/dsh-doc ' });
			h.cleanup();
			// A fresh mount restores the inserted draft (HMR/reload DX). The
			// restore rides a microtask + flushSync — no real-time wait (this
			// test runs on FAKE timers; the 250 ms real settle would hang).
			const h2 = mountMenu({ onpickskill });
			expect(h2.value()).toBe('/dsh-doc ');
			for (let i = 0; i < 4; i++) {
				flushSync();
			await Promise.resolve();
			}
			flushSync();
			h2.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});
});
