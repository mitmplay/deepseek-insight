/**
 * SidebarPromptSync unit tests — the sidebar footer's broadcast box (ADR
 * "The Prompt Sync", 2026-09-04):
 *  - D7: renders NOTHING while no panel is checked; reveals with ≥1 and
 *    labels the count ("Broadcast · 1 panel" / "2 panels");
 *  - the textarea IS the store's shared text: typing pushes (and a fake
 *    member mirrors), submit clears the box;
 *  - D5: Submit runs each member's own ladder; a pass where everyone
 *    refused earns the honest note (prompt-sync-note);
 *  - D4: Cancel restores every member's pristine snapshot;
 *  - Enter submits; IME composition never does.
 *
 * Fake members stand in for panels (registerSyncMember + setSyncChecked)
 * — the box never knows the difference (props-free store contract, D2).
 */
import { flushSync, mount, unmount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SidebarPromptSync from '$lib/components/sessions/SidebarPromptSync.svelte';
import type { SyncMember, SyncSlashMember, SyncStripMember } from '$lib/services/chat/prompt-sync.svelte';
import {
	readSharedText,
	registerSyncMember,
	resetPromptSyncForTests,
	setSyncChecked
} from '$lib/services/chat/prompt-sync.svelte';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function fakeMember(initial = '', verdict = true) {
	const state = { current: initial };
	const submit = vi.fn(async (): Promise<boolean> => {
		if (verdict) state.current = '';
		return verdict;
	});
	const member: SyncMember = {
		getText: () => state.current,
		setText: (text: string) => {
			state.current = text;
		},
		submit
	};
	return { member, submit, text: () => state.current };
}

/** A fake member with the strip hand — `count` rows at `index`, a call
 *  log for the fanout assertions, and a submit spy the send tests read.
 *  The strip state lives in a SvelteMap so the box's derived strip VIEW
 *  tracks it exactly like it tracks a real panel's $state. */
const STRIP_ROWS = [
	{ id: 1, label: 'commit', text: 'commit all and push', use_count: 7, macro: 0, last_used_at: '2026-09-04T00:00:00.000Z', tags: '' },
	{ id: 2, label: null, text: 'commit the rest quietly', use_count: 2, macro: 0, last_used_at: '2026-09-04T00:00:00.000Z', tags: '' }
];

function fakeStripMember(initial = '', rowCount = 2) {
	const base = fakeMember(initial);
	const state = new SvelteMap<string, number | string>([
		['count', rowCount],
		['index', 0],
		['query', '?com'],
		['mode', 'find']
	]);
	const strip = {
		get count(): number {
			return state.get('count') as number;
		},
		set count(v: number) {
			state.set('count', v);
		},
		get index(): number {
			return state.get('index') as number;
		},
		set index(v: number) {
			state.set('index', v);
		},
		get query(): string {
			return state.get('query') as string;
		},
		set query(v: string) {
			state.set('query', v);
		},
		get mode(): 'find' | 'run' {
			return state.get('mode') as 'find' | 'run';
		},
		set mode(v: 'find' | 'run') {
			state.set('mode', v);
		}
	};
	const calls: string[] = [];
	const member: SyncStripMember = {
		...base.member,
		syncStripState: () => {
			const count = strip.count;
			if (count <= 0) return null;
			return {
				rows: STRIP_ROWS.slice(0, count),
				index: strip.index,
				query: strip.query,
				mode: strip.mode
			};
		},
		syncCycleStrip: (delta: number) => {
			calls.push(`cycle${delta}`);
			strip.index = ((strip.index + delta) % strip.count + strip.count) % strip.count;
		},
		syncAcceptStrip: () => calls.push('accept'),
		syncDismissStrip: () => {
			calls.push('dismiss');
			strip.count = 0;
		}
	};
	return { ...base, member, strip, calls };
}

/** A fake member with the slash-menu hand — a live view over the fixture
 *  catalog. The view fields live in a SvelteMap so the box's derived
 *  slash VIEW tracks them exactly like it tracks a real panel's $state
 *  (the strip fake's rule). */
const SLASH_GESTURES = [
	{ name: 'new', display: '/new', seed: '/new ', description: 'Creates a fresh session in this panel' }
];
const SLASH_COMMANDS = [
	{ name: 'compact', description: 'Compact the session context' },
	{ name: 'plan', description: 'Plan the next turn', input: { hint: 'what should the next turn do' } }
];
const SLASH_SKILLS = [{ name: 'dsh-doc', description: 'Answer from the DSH docs', modelInvocable: true }];

function fakeSlashMember(initial = '', query = '/com') {
	const base = fakeMember(initial);
	const state = new SvelteMap<string, string | number | boolean>([
		['open', true],
		['index', 0],
		['query', query],
		['state', 'ready']
	]);
	const slash = {
		get open(): boolean {
			return state.get('open') as boolean;
		},
		set open(v: boolean) {
			state.set('open', v);
		},
		get index(): number {
			return state.get('index') as number;
		},
		set index(v: number) {
			state.set('index', v);
		},
		get query(): string {
			return state.get('query') as string;
		},
		set query(v: string) {
			state.set('query', v);
		},
		get state(): 'idle' | 'loading' | 'ready' | 'failed' {
			return state.get('state') as 'idle' | 'loading' | 'ready' | 'failed';
		},
		set state(v: 'idle' | 'loading' | 'ready' | 'failed') {
			state.set('state', v);
		}
	};
	const calls: string[] = [];
	const member: SyncSlashMember = {
		...base.member,
		syncSlashState: () =>
			slash.open
				? {
						gestures: SLASH_GESTURES,
						commands: SLASH_COMMANDS,
						skills: SLASH_SKILLS,
						state: slash.state,
						query: slash.query,
						index: slash.index
					}
				: null,
		syncCycleSlash: (delta: number) => {
			calls.push(`cycle${delta}`);
			slash.index += delta;
		},
		syncDismissSlash: () => {
			calls.push('dismiss');
			slash.open = false;
		},
		syncAcceptSlashInsert: (text: string) => {
			calls.push(`insert:${text}`);
			base.member.setText(text);
			slash.open = false; // the memo-close
		},
		syncAcceptSlashExecute: (name: string) => {
			calls.push(`execute:${name}`);
			base.member.setText('');
		}
	};
	return { ...base, member, slash, calls };
}

/** Dispatch a keydown on the box's textarea. */
function pressKey(h: ReturnType<typeof mountBox>, key: string, opts: { shift?: boolean } = {}): KeyboardEvent {
	const ev = new KeyboardEvent('keydown', {
		key,
		shiftKey: opts.shift ?? false,
		bubbles: true,
		cancelable: true
	});
	h.textarea().dispatchEvent(ev);
	flushSync();
	return ev;
}

function mountBox() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(SidebarPromptSync, { target });
	flushSync();
	const box = () => target.querySelector('[data-testid="sidebar-prompt-sync"]');
	const textarea = () =>
		target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
	const submitBtn = () =>
		target.querySelector('[data-testid="prompt-sync-submit"]') as HTMLButtonElement;
	const cancelBtn = () =>
		target.querySelector('[data-testid="prompt-sync-cancel"]') as HTMLButtonElement;
	const note = () => target.querySelector('[data-testid="prompt-sync-note"]');
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, box, textarea, submitBtn, cancelBtn, note, cleanup };
}

/** Type into the box and fire the input event (native-like). */
function typeBox(h: ReturnType<typeof mountBox>, text: string): void {
	const ta = h.textarea();
	ta.value = text;
	ta.selectionStart = ta.selectionEnd = text.length;
	ta.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

beforeEach(() => {
	resetPromptSyncForTests();
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('visibility (D7)', () => {
	it('renders nothing while no panel is checked', () => {
		const h = mountBox();
		expect(h.box()).toBeNull();
		h.cleanup();
	});

	it('reveals with one checked panel and labels the singular count', () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		expect(h.box()).toBeTruthy();
		expect(h.target.querySelector('[data-testid="prompt-sync-count"]')?.textContent?.trim()).toBe(
			'Broadcast · 1 panel'
		);
		h.cleanup();
	});

	it('hides again when every panel unchecks', () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		setSyncChecked(A, false);
		flushSync();
		expect(h.box()).toBeNull();
		h.cleanup();
	});
});

describe('typing is the shared text (D3)', () => {
	it('typing pushes to the store and mirrors into the fake member', () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		typeBox(h, 'hello panels');
		expect(readSharedText()).toBe('hello panels');
		// the member's mirror effect is the PANEL's job (component tests
		// pin it); the store side is what the box owns:
		expect(h.textarea().value).toBe('hello panels');
		h.cleanup();
	});

	it('backspacing the box empty pushes the empty (the mirrored empty)', () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		typeBox(h, 'hello');
		expect(readSharedText()).toBe('hello');
		const ta = h.textarea();
		ta.value = '';
		ta.selectionStart = ta.selectionEnd = 0;
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(readSharedText()).toBe(''); // the store heard the deletion
		h.cleanup();
	});

	it('the placeholder names the checked count', () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		registerSyncMember(B, fakeMember('').member);
		const h = mountBox();
		setSyncChecked(A, true);
		setSyncChecked(B, true);
		flushSync();
		expect(h.textarea().placeholder).toContain('2 checked panels');
		h.cleanup();
	});
});

describe('submit (D5)', () => {
	it('runs every member ladder and clears the box', async () => {
		const a = fakeMember('');
		const b = fakeMember('');
		registerSyncMember(A, a.member);
		registerSyncMember(B, b.member);
		const h = mountBox();
		setSyncChecked(A, true);
		setSyncChecked(B, true);
		flushSync();
		typeBox(h, 'go both');
		expect(h.submitBtn().disabled).toBe(false);
		h.submitBtn().click();
		// The pass is SEQUENTIAL (D5): wait for its completion signal —
		// the shared text clearing — not for the first member's call.
		await vi.waitFor(() => expect(readSharedText()).toBe(''));
		expect(a.submit).toHaveBeenCalledOnce();
		expect(b.submit).toHaveBeenCalledOnce();
		flushSync();
		expect(h.textarea().value).toBe('');
		expect(h.note()).toBeNull(); // both dispatched — no note
		h.cleanup();
	});

	it('a pass where every panel refused shows the honest note', async () => {
		const a = fakeMember('', false);
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		typeBox(h, 'nobody takes it');
		h.submitBtn().click();
		// The note renders after the whole pass completes (submitAll's
		// awaits) — wait for it directly.
		await vi.waitFor(() => expect(h.note()).toBeTruthy());
		expect(h.note()?.textContent).toContain('Nothing sent');
		h.cleanup();
	});

	it('the submit button is disabled while the box is empty', () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		expect(h.submitBtn().disabled).toBe(true);
		h.cleanup();
	});

	it('Enter submits; Shift+Enter does not; IME composition never does', async () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		typeBox(h, 'enter sends');

		h.textarea().dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
		);
		flushSync();
		expect(a.submit).not.toHaveBeenCalled();

		// IME: composing — Enter is a keystroke of text, not a broadcast.
		h.textarea().dispatchEvent(new CompositionEvent('compositionstart'));
		h.textarea().dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
		);
		flushSync();
		expect(a.submit).not.toHaveBeenCalled();
		h.textarea().dispatchEvent(new CompositionEvent('compositionend'));

		h.textarea().dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
		);
		await vi.waitFor(() => expect(a.submit).toHaveBeenCalledOnce());
		h.cleanup();
	});
});

describe('the broadcast strip grammar (amended 2026-09-04)', () => {
	it('arrows cycle the panels\u2019 highlight; Tab writes the row through the mirror; Esc dismisses', () => {
		const a = fakeStripMember('');
		const b = fakeStripMember('');
		registerSyncMember(A, a.member);
		registerSyncMember(B, b.member);
		const h = mountBox();
		setSyncChecked(A, true);
		setSyncChecked(B, true);
		flushSync();

		pressKey(h, 'ArrowDown');
		expect(a.calls).toEqual(['cycle1']);
		expect(b.calls).toEqual(['cycle1']);
		expect(a.strip.index).toBe(1);

		// Tab is a WRITE-THROUGH accept: the row text becomes the shared
		// draft (box and panels land in-sync) — no per-panel replay, no send.
		pressKey(h, 'Tab');
		expect(readSharedText()).toBe('commit the rest quietly'); // the index-1 row
		expect(a.calls).toEqual(['cycle1']);
		expect(a.submit).not.toHaveBeenCalled();

		pressKey(h, 'Escape');
		expect(a.calls).toEqual(['cycle1', 'dismiss']);
		expect(b.calls).toEqual(['cycle1', 'dismiss']);
		h.cleanup();
	});

	it('a run-mode pick replays per panel and ends the broadcast', () => {
		const a = fakeStripMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		// The member's live view is a `!`-query — the accept must RUN per
		// panel, never write the row text as the broadcast draft, and the
		// run consumed the shared draft (the macro was the send).
		typeBox(h, '!deploy');
		a.strip.query = '!deploy';
		a.strip.mode = 'run';
		flushSync();
		pressKey(h, 'Tab');
		expect(a.calls).toEqual(['accept']);
		expect(readSharedText()).toBe('');
		expect(h.textarea().value).toBe('');
		h.cleanup();
	});

	it('the strip view renders over the box and follows the borrowed highlight', () => {
		const a = fakeStripMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		const strip = () => h.target.querySelector('[data-testid="suggest-strip"]');
		const selected = () => h.target.querySelector('.strip-pick[aria-selected="true"]');
		expect(strip()).not.toBeNull(); // the view rides the live member strip
		expect(h.target.querySelectorAll('[role="option"]')).toHaveLength(2);
		expect(selected()?.textContent).toContain('commit'); // index 0
		expect(h.target.querySelectorAll('.strip-menu-btn')).toHaveLength(0); // pick-only

		pressKey(h, 'ArrowDown');
		expect(selected()?.textContent).toContain('quietly'); // borrowed index moved

		pressKey(h, 'Escape');
		flushSync();
		expect(strip()).toBeNull(); // the dismiss emptied the view
		h.cleanup();
	});

	it('Shift+Tab cycles back; a one-row strip ignores arrows', () => {
		const a = fakeStripMember('', 1);
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		pressKey(h, 'Tab', { shift: true });
		expect(a.calls).toEqual([]); // one row — Shift+Tab is swallowed
		pressKey(h, 'ArrowDown');
		expect(a.calls).toEqual([]); // nothing to cycle
		a.strip.count = 2;
		pressKey(h, 'ArrowUp');
		expect(a.calls).toEqual(['cycle-1']);
		expect(a.strip.index).toBe(1); // wrapped backwards
		h.cleanup();
	});

	it('Enter on a find-mode view stays the broadcast send — never a strip accept', async () => {
		const a = fakeStripMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		typeBox(h, '?com');

		pressKey(h, 'Enter');
		await vi.waitFor(() => expect(a.submit).toHaveBeenCalledOnce());
		expect(a.calls).toEqual([]); // no accept replay — Enter went straight to the send
		h.cleanup();
	});

	it('Enter on a live run-mode view executes the macro — no broadcast, no wire line', async () => {
		const a = fakeStripMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		typeBox(h, '!deploy');
		a.strip.query = '!deploy';
		a.strip.mode = 'run';
		flushSync();

		pressKey(h, 'Enter');
		expect(a.calls).toEqual(['accept']); // the highlighted row replayed per panel
		expect(a.submit).not.toHaveBeenCalled(); // the raw `!deploy` never rode a ladder
		expect(readSharedText()).toBe(''); // the run consumed the broadcast
		flushSync();
		expect(h.textarea().value).toBe('');
		h.cleanup();
	});

	it('with no live strip the keys keep their plain grammar (native Tab, Enter submits)', async () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		typeBox(h, 'plain prose');

		const tab = pressKey(h, 'Tab');
		expect(tab.defaultPrevented).toBe(false); // native focus move
		pressKey(h, 'Enter');
		await vi.waitFor(() => expect(a.submit).toHaveBeenCalledOnce());
		h.cleanup();
	});
});

describe('the broadcast slash view (amended 2026-09-04 — the third surface)', () => {
	it('the menu renders over the box and follows the borrowed highlight', () => {
		const a = fakeSlashMember('', '/');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		const menu = () => h.target.querySelector('[data-testid="slash-menu"]');
		expect(menu()).not.toBeNull(); // the view rides the live member menu
		expect(h.target.querySelectorAll('[data-testid="slash-gesture-row"]')).toHaveLength(1);
		expect(h.target.querySelectorAll('[data-testid="slash-command-row"]')).toHaveLength(2);
		expect(h.target.querySelectorAll('[data-testid="slash-skill-row"]')).toHaveLength(1);
		expect(h.target.querySelector('[data-testid="slash-gesture-row"][data-name="new"]')?.classList.contains('active')).toBe(true);

		pressKey(h, 'ArrowDown'); // /new → /compact (the borrowed index moves)
		expect(h.target.querySelector('[data-testid="slash-command-row"][data-name="compact"]')?.classList.contains('active')).toBe(true);
		h.cleanup();
	});

	it('Enter on an INSERT-kind pick writes the seed through and keeps the broadcast', () => {
		const a = fakeSlashMember('', '/');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		typeBox(h, '/'); // everything matches — index 0 is the /new gesture

		pressKey(h, 'Enter');
		expect(a.calls).toEqual(['insert:/new ']); // the pick replayed — no ladder
		expect(a.submit).not.toHaveBeenCalled();
		expect(readSharedText()).toBe('/new '); // the write-through seeded the box
		flushSync();
		expect(h.textarea().value).toBe('/new ');
		h.cleanup();
	});

	it('Enter on an EXECUTE-kind pick runs it per panel and ends the broadcast', () => {
		const a = fakeSlashMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		typeBox(h, '/com'); // index 0 = the hint-less /compact (execute)

		pressKey(h, 'Enter');
		expect(a.calls).toEqual(['execute:compact']); // the member's own line ran host-side
		expect(a.submit).not.toHaveBeenCalled(); // the raw line never rode a ladder
		expect(readSharedText()).toBe(''); // the run consumed the broadcast
		flushSync();
		expect(h.textarea().value).toBe('');
		h.cleanup();
	});

	it('Esc dismisses the menu view — the box returns to its plain grammar', () => {
		const a = fakeSlashMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		expect(h.target.querySelector('[data-testid="slash-menu"]')).not.toBeNull();

		pressKey(h, 'Escape');
		expect(a.calls).toEqual(['dismiss']);
		flushSync();
		expect(h.target.querySelector('[data-testid="slash-menu"]')).toBeNull();
		h.cleanup();
	});
});

describe('pointer picks and remaining keyboard arms (coverage 2026-09-05)', () => {
	it('clicking a strip row writes it through the mirror (find mode)', () => {
		const a = fakeStripMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		(h.target.querySelectorAll('.strip-pick')[1] as HTMLElement).click();
		flushSync();
		expect(readSharedText()).toBe('commit the rest quietly');
		expect(a.submit).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('Shift+Tab on a multi-row strip cycles back', () => {
		const a = fakeStripMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		pressKey(h, 'Tab', { shift: true });
		expect(a.calls).toEqual(['cycle-1']);
		h.cleanup();
	});

	it('clicking each slash row kind replays the right accept', () => {
		const a = fakeSlashMember('', '/');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		// gesture pick → insert the seed through the mirror
		(h.target.querySelector('[data-testid="slash-gesture-row"][data-name="new"]') as HTMLElement).click();
		flushSync();
		expect(a.calls).toEqual(['insert:/new ']);
		expect(readSharedText()).toBe('/new ');
		// reopen (the insert memo-closed the member's view) and pick the
		// hint-less command → execute per panel, broadcast consumed
		a.slash.open = true;
		flushSync();
		(h.target.querySelector('[data-testid="slash-command-row"][data-name="compact"]') as HTMLElement).click();
		expect(a.calls).toEqual(['insert:/new ', 'execute:compact']);
		expect(readSharedText()).toBe('');
		// reopen and pick the hinted command → insert '/plan '
		a.slash.open = true;
		flushSync();
		(h.target.querySelector('[data-testid="slash-command-row"][data-name="plan"]') as HTMLElement).click();
		expect(a.calls).toEqual(['insert:/new ', 'execute:compact', 'insert:/plan ']);
		expect(readSharedText()).toBe('/plan ');
		// reopen and pick the skill → insert '/dsh-doc '
		a.slash.open = true;
		flushSync();
		(h.target.querySelector('[data-testid="slash-skill-row"][data-name="dsh-doc"]') as HTMLElement).click();
		expect(a.calls).toEqual(['insert:/new ', 'execute:compact', 'insert:/plan ', 'insert:/dsh-doc ']);
		expect(readSharedText()).toBe('/dsh-doc ');
		h.cleanup();
	});

	it('slash-view arrows and Tab/Shift+Tab ride the borrowed highlight', () => {
		const a = fakeSlashMember('', '/');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		pressKey(h, 'ArrowUp');
		expect(a.calls).toEqual(['cycle-1']);
		pressKey(h, 'Tab', { shift: true });
		expect(a.calls).toEqual(['cycle-1', 'cycle-1']);
		// The fake's index is raw (0 → -1 → -2): park it on a real row and
		// Tab-accept — index 1 is the hint-less /compact (execute kind).
		a.slash.index = 1;
		pressKey(h, 'Tab');
		expect(a.calls).toEqual(['cycle-1', 'cycle-1', 'execute:compact']);
		h.cleanup();
	});

	it('a loading slash view never matches — Enter stays the broadcast send', async () => {
		const a = fakeSlashMember('', '/com');
		a.slash.open = true;
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		typeBox(h, 'plain prose');
		// Flip the ONE checked member's view to loading: the rows exist as
		// data, but the composite gate reads state !== 'ready' and matches
		// nothing, so Enter keeps the broadcast send grammar.
		a.slash.state = 'loading';
		flushSync();
		const ev = pressKey(h, 'Enter');
		expect(ev.defaultPrevented).toBe(true); // the send path took it
		await vi.waitFor(() => expect(a.submit).toHaveBeenCalledOnce());
		h.cleanup();
	});

	it('Enter on an empty draft does nothing — no dispatch, no note', async () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		pressKey(h, 'Enter');
		await new Promise((r) => setTimeout(r, 10));
		expect(a.submit).not.toHaveBeenCalled();
		expect(h.note()).toBeNull();
		h.cleanup();
	});

	it('the placeholder names a single checked panel in the singular', () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		expect(h.textarea().placeholder).toContain('1 checked panel');
		h.cleanup();
	});
});

describe('cancel (D4)', () => {
	it('restores every pristine snapshot and clears the box', () => {
		const a = fakeMember('old a');
		const b = fakeMember('old b');
		registerSyncMember(A, a.member);
		registerSyncMember(B, b.member);
		const h = mountBox();
		setSyncChecked(A, true);
		setSyncChecked(B, true);
		flushSync();
		typeBox(h, 'overwritten');
		h.cancelBtn().click();
		flushSync();
		expect(a.text()).toBe('old a');
		expect(b.text()).toBe('old b');
		expect(readSharedText()).toBe('');
		expect(h.textarea().value).toBe('');
		h.cleanup();
	});

	it('a stale note clears with the box when the set empties', () => {
		const a = fakeMember('', false);
		registerSyncMember(A, a.member);
		const h = mountBox();
		setSyncChecked(A, true);
		flushSync();
		typeBox(h, 'refused');
		h.cancelBtn().click();
		setSyncChecked(A, false);
		flushSync();
		expect(h.note()).toBeNull();
		h.cleanup();
	});
});
