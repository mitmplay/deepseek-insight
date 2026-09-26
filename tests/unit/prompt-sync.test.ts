/**
 * Prompt Sync store unit tests — the broadcast state machine (ADR "The
 * Prompt Sync", 2026-09-04, D4 as amended the same day) over fake members:
 *  - registration + disposer (own-registration-only unbind);
 *  - D4: check snapshots pristine BEFORE any mirror; a check with an
 *    empty shared text claims nothing and writes nothing; a claimed
 *    panel mirrors verbatim, '' included; Cancel restores exactly;
 *  - D3: push is the one write; uncheck keeps the panel's text;
 *  - D5: submitAll counts dispatched/kept, clears text + pristine, and
 *    the checked group survives for the next broadcast;
 *  - D1/D6: pruneSync drops sessions off the floor; resetSync clears all.
 *
 * Fake members mimic the Composer contract: getText/setText on a local
 * string, submit a vi.fn that clears and admits (or refuses, per test).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncMember, SyncSlashMember, SyncStripMember } from '$lib/services/chat/prompt-sync.svelte';
import {
	acceptSyncSlashExecute,
	acceptSyncSlashInsert,
	acceptSyncStrip,
	cancelSync,
	cycleSyncSlash,
	cycleSyncStrip,
	dismissSyncSlash,
	dismissSyncStrip,
	isSyncChecked,
	mirrorTextFor,
	pruneSync,
	pushSharedText,
	readSharedText,
	registerSyncMember,
	resetPromptSyncForTests,
	setSyncChecked,
	submitAll,
	syncCheckedCount,
	syncSlashState,
	syncStripState
} from '$lib/services/chat/prompt-sync.svelte';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** A fake panel composer: local text + a controllable submit verdict. */
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
	return {
		member,
		submit,
		text: () => state.current,
		set: (text: string) => {
			state.current = text;
		}
	};
}

/** A fake panel composer with the optional strip hand — a live strip
 *  (`count` rows at `index`) plus a call log for the fanout assertions. */
const STRIP_ROWS = [
	{ id: 1, label: 'commit', text: 'commit all and push', use_count: 7, macro: 0, last_used_at: '2026-09-04T00:00:00.000Z', tags: '' },
	{ id: 2, label: null, text: 'commit the rest quietly', use_count: 2, macro: 0, last_used_at: '2026-09-04T00:00:00.000Z', tags: '' }
];

function fakeStripMember(initial = '', rowCount = 2, mode: 'find' | 'run' = 'find') {
	const base = fakeMember(initial);
	const strip = { count: rowCount, index: 0 };
	const calls: string[] = [];
	const member: SyncStripMember = {
		...base.member,
		syncStripState: () =>
			strip.count > 0
				? {
						rows: STRIP_ROWS.slice(0, strip.count),
						index: strip.index,
						query: mode === 'run' ? '!deploy' : '?com',
						mode
					}
				: null,
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

	beforeEach(() => {
		resetPromptSyncForTests();
	});

	/** A fake panel composer with the slash-menu hand — a live view over
	 *  a tiny fixture catalog plus a call log for the fanout assertions. */
	const SLASH_GESTURES = [
		{ name: 'new', display: '/new', seed: '/new ', description: 'Creates a fresh session in this panel' }
	];
	const SLASH_COMMANDS = [{ name: 'compact', description: 'Compact the session context' }];
	const SLASH_SKILLS = [{ name: 'dsh-doc', description: 'Answer from the DSH docs', modelInvocable: true }];

	function fakeSlashMember(initial = '', open = true) {
		const base = fakeMember(initial);
		const slash = { open };
		const calls: string[] = [];
		const member: SyncSlashMember = {
			...base.member,
			syncSlashState: () =>
				slash.open
					? {
							gestures: SLASH_GESTURES,
							commands: SLASH_COMMANDS,
							skills: SLASH_SKILLS,
							state: 'ready' as const,
							query: '/com',
							index: 0
						}
					: null,
			syncCycleSlash: (delta: number) => calls.push(`cycle${delta}`),
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

	beforeEach(() => {
		resetPromptSyncForTests();
	});

	describe('membership (D1/D2)', () => {
		it('register returns a disposer that unregisters its own member', () => {
			const a = fakeMember('a');
			const b = fakeMember('b');
			const disposeA = registerSyncMember(A, a.member);
		registerSyncMember(B, b.member);
		disposeA();
		setSyncChecked(A, true); // no member left for A
		setSyncChecked(B, true);
		expect(a.text()).toBe('a'); // untouched — the dispose ran
		expect(isSyncChecked(A)).toBe(true);
		expect(isSyncChecked(B)).toBe(true);
	});

	it('a stale disposer (replaced registration) does not unbind the current member', () => {
		const first = fakeMember('one');
		const second = fakeMember('two');
		const disposeFirst = registerSyncMember(A, first.member);
		registerSyncMember(A, second.member);
		disposeFirst();
		expect(second.text()).toBe('two');
		setSyncChecked(A, true); // snapshots the CURRENT member's text
		cancelSync();
		expect(second.text()).toBe('two'); // restored to its own pre-check text
		expect(first.text()).toBe('one'); // the disposed member was never touched
	});
});

describe('check semantics (D4)', () => {
	it('check snapshots the draft before any mirror; Cancel restores exactly', () => {
		const a = fakeMember('old draft');
		registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		pushSharedText('broadcast');
		expect(a.text()).toBe('old draft'); // store changed, member not yet notified
		// the mirror write is the panel effect's job — simulate it:
		const mirrored = mirrorTextFor(A);
		expect(mirrored).toBe('broadcast');
		a.set(mirrored ?? '');
		cancelSync();
		expect(a.text()).toBe('old draft'); // Cancel's promise, kept
		expect(readSharedText()).toBe('');
	});

	it('a check with an empty shared text claims nothing (never wipes)', () => {
		const a = fakeMember('precious');
		registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		expect(mirrorTextFor(A)).toBeUndefined(); // the store's write-nothing verdict
		expect(a.text()).toBe('precious');
	});

	it('uncheck keeps the panel text and drops the snapshot (no restore later)', () => {
		const a = fakeMember('mine');
		registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		pushSharedText('theirs');
		const mirrored = mirrorTextFor(A);
		expect(mirrored).toBe('theirs');
		a.set(mirrored ?? '');
		setSyncChecked(A, false);
		cancelSync();
		expect(a.text()).toBe('theirs'); // local state is its own now
		expect(isSyncChecked(A)).toBe(false);
	});

	it('unchecking the last panel clears the shared text', () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		pushSharedText('hi');
		setSyncChecked(A, false);
		expect(readSharedText()).toBe('');
		expect(syncCheckedCount()).toBe(0);
	});

	it('mirrorTextFor is undefined for an unchecked session even with shared text', () => {
		pushSharedText('loose text');
		expect(mirrorTextFor(A)).toBeUndefined();
	});
});

describe('the empty push (D4 as amended 2026-09-04)', () => {
	it('clearing the box mirrors an empty into a claimed panel', () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		setSyncChecked(A, true); // box empty — unclaimed
		pushSharedText('abc'); // the claim
		expect(mirrorTextFor(A)).toBe('abc');
		pushSharedText(''); // the backspace that empties the box
		expect(mirrorTextFor(A)).toBe(''); // claimed panels mirror the empty
	});

	it('a panel checked into an emptied box stays unclaimed until the next push', () => {
		const a = fakeMember('');
		const b = fakeMember('');
		registerSyncMember(A, a.member);
		registerSyncMember(B, b.member);
		setSyncChecked(A, true);
		pushSharedText('abc');
		pushSharedText(''); // the box emptied — A stays claimed
		setSyncChecked(B, true); // B joins an empty box — claims nothing
		expect(mirrorTextFor(B)).toBeUndefined(); // D4: a check never wipes
		pushSharedText('next');
		expect(mirrorTextFor(A)).toBe('next');
		expect(mirrorTextFor(B)).toBe('next'); // the push claims every checked session
	});

	it('submit and cancel end the claims — the kept draft and the restore survive', async () => {
		const a = fakeMember('', false); // refuses — the kept panel
		registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		pushSharedText('kept text');
		const mirrored = mirrorTextFor(A);
		expect(mirrored).toBe('kept text');
		a.set(mirrored ?? ''); // the panel effect's write
		await submitAll();
		expect(mirrorTextFor(A)).toBeUndefined(); // the pass ended the claim
		expect(a.text()).toBe('kept text'); // D5: kept keeps its mirrored draft
		setSyncChecked(A, true); // re-check for the cancel half
		pushSharedText('again');
		expect(mirrorTextFor(A)).toBe('again');
		cancelSync();
		expect(mirrorTextFor(A)).toBeUndefined(); // the cancel ended the claim
		expect(a.text()).toBe('kept text'); // the restore, not an empty echo
	});
});

describe('submitAll (D5)', () => {
	it('dispatches each checked member in order and counts refusals', async () => {
		const a = fakeMember('', true);
		const b = fakeMember('', false);
		registerSyncMember(A, a.member);
		registerSyncMember(B, b.member);
		setSyncChecked(A, true);
		setSyncChecked(B, true);
		pushSharedText('go');
		const order: string[] = [];
		a.submit.mockImplementation(async () => {
			order.push('a');
			return true;
		});
		b.submit.mockImplementation(async () => {
			order.push('b');
			return false;
		});
		const result = await submitAll();
		expect(order).toEqual(['a', 'b']); // sequential, check order
		expect(result).toEqual({ dispatched: 1, kept: [B] });
		expect(readSharedText()).toBe(''); // the pass clears the box
	});

	it('the checked group survives submit — the next broadcast reuses it', async () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		pushSharedText('first');
		await submitAll();
		expect(syncCheckedCount()).toBe(1);
		pushSharedText('second');
		await submitAll();
		expect(a.submit).toHaveBeenCalledTimes(2);
	});

	it('submit clears the pristine snapshots — Cancel after submit restores nothing', async () => {
		const a = fakeMember('old');
		registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		a.set('sent'); // mirrored + replaced by the submit
		await submitAll();
		cancelSync();
		expect(a.text()).toBe(''); // the send happened; there is nothing to undo
	});

	it('a checked session whose member is gone counts as kept', async () => {
		const a = fakeMember('');
		const dispose = registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		dispose(); // the panel unmounted without unchecking (prune pending)
		const result = await submitAll();
		expect(result).toEqual({ dispatched: 0, kept: [A] });
	});
});

describe('the broadcast strip (amended 2026-09-04 — the box replays the grammar)', () => {
	it('syncStripState reads the first checked live strip; none live is null', () => {
		const a = fakeStripMember('');
		registerSyncMember(A, a.member);
		expect(syncStripState()).toBeNull(); // unchecked
		setSyncChecked(A, true);
		const view = syncStripState();
		expect(view?.rows).toHaveLength(2);
		expect(view?.index).toBe(0);
		expect(view?.query).toBe('?com');
		expect(view?.mode).toBe('find');
		a.strip.count = 0; // the member's strip died (dismissed/failed fetch)
		expect(syncStripState()).toBeNull();
	});

	it('cycle/accept/dismiss fan out to every checked strip member in check order', () => {
		const a = fakeStripMember('');
		const b = fakeStripMember('');
		registerSyncMember(A, a.member);
		registerSyncMember(B, b.member);
		setSyncChecked(A, true);
		setSyncChecked(B, true);
		cycleSyncStrip(1);
		expect(a.calls).toEqual(['cycle1']);
		expect(b.calls).toEqual(['cycle1']);
		expect(a.strip.index).toBe(1);
		acceptSyncStrip('find');
		expect(a.calls).toEqual(['cycle1', 'accept']);
		expect(b.calls).toEqual(['cycle1', 'accept']);
		dismissSyncStrip();
		expect(a.calls).toEqual(['cycle1', 'accept', 'dismiss']);
		expect(b.calls).toEqual(['cycle1', 'accept', 'dismiss']);
	});

	it('members without the strip hand sit out; unchecked sessions are never touched', () => {
		const a = fakeStripMember('');
		const b = fakeMember(''); // a plain composer — no strip methods
		const c = fakeStripMember('');
		registerSyncMember(A, a.member);
		registerSyncMember(B, b.member);
		registerSyncMember('33333333-3333-4333-8333-333333333333', c.member);
		setSyncChecked(A, true);
		setSyncChecked(B, true); // checked but strip-less — skipped
		cycleSyncStrip(1);
		acceptSyncStrip('find');
		expect(a.calls).toEqual(['cycle1', 'accept']);
		const view = syncStripState();
		expect(view?.rows).toHaveLength(2);
		expect(view?.index).toBe(1);
		expect(c.calls).toEqual([]); // unchecked — untouched
	});

	it('a run accept ends the broadcast — the macro consumed the shared draft', () => {
		const a = fakeStripMember('', 2, 'run');
		registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		pushSharedText('!deploy'); // the box's raw macro line, mirrored live
		expect(readSharedText()).toBe('!deploy');
		acceptSyncStrip('run');
		expect(a.calls).toEqual(['accept']); // the replay fired
		expect(readSharedText()).toBe(''); // the box cleared — the run was the send
		expect(mirrorTextFor(A)).toBeUndefined(); // the claim ended
		expect(isSyncChecked(A)).toBe(true); // the checked group survives
	});

	it('a find accept leaves the broadcast alone — the send is still press 2 away', () => {
		const a = fakeStripMember('');
		registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		pushSharedText('?com');
		acceptSyncStrip('find');
		expect(a.calls).toEqual(['accept']);
		expect(readSharedText()).toBe('?com'); // untouched — write-through owns the draft
		expect(mirrorTextFor(A)).toBe('?com'); // the claim rides on
	});
});

describe('the broadcast slash view (amended 2026-09-04 — the third surface)', () => {
	it('syncSlashState reads the first checked live menu; none live is null', () => {
		const a = fakeSlashMember('');
		registerSyncMember(A, a.member);
		expect(syncSlashState()).toBeNull(); // unchecked
		setSyncChecked(A, true);
		const view = syncSlashState();
		expect(view?.state).toBe('ready');
		expect(view?.query).toBe('/com');
		expect(view?.commands).toHaveLength(1);
		a.slash.open = false; // the member dismissed (memoized)
		expect(syncSlashState()).toBeNull();
	});

	it('cycle and dismiss fan out to every checked slash member in check order', () => {
		const a = fakeSlashMember('');
		const b = fakeSlashMember('');
		registerSyncMember(A, a.member);
		registerSyncMember(B, b.member);
		setSyncChecked(A, true);
		setSyncChecked(B, true);
		cycleSyncSlash(1);
		expect(a.calls).toEqual(['cycle1']);
		expect(b.calls).toEqual(['cycle1']);
		dismissSyncSlash();
		expect(a.calls).toEqual(['cycle1', 'dismiss']);
		expect(b.calls).toEqual(['cycle1', 'dismiss']);
	});

	it('an insert pick fans the seed to every member and keeps the broadcast alive', () => {
		const a = fakeSlashMember('');
		const b = fakeSlashMember('');
		registerSyncMember(A, a.member);
		registerSyncMember(B, b.member);
		setSyncChecked(A, true);
		setSyncChecked(B, true);
		pushSharedText('/com');
		acceptSyncSlashInsert('/new ');
		expect(a.calls).toEqual(['insert:/new ']);
		expect(b.calls).toEqual(['insert:/new ']);
		expect(a.text()).toBe('/new '); // the member's own pickInsert semantics
		expect(readSharedText()).toBe('/com'); // the box's write is the caller's (pushSharedText)
		expect(mirrorTextFor(A)).toBe('/com'); // the claims ride on — press 2 is coming
	});

	it('an execute pick fans the run and ends the broadcast — the run consumed the intent', async () => {
		const a = fakeSlashMember('');
		registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		pushSharedText('/compact');
		acceptSyncSlashExecute('compact');
		expect(a.calls).toEqual(['execute:compact']);
		expect(readSharedText()).toBe(''); // the box cleared
		expect(mirrorTextFor(A)).toBeUndefined(); // the claims ended
		expect(isSyncChecked(A)).toBe(true); // the checked group survives
	});
});

describe('prune + reset (D1/D6)', () => {
	it('pruneSync drops checks for sessions off the floor; the count-0 clears text', () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		setSyncChecked(B, true); // no member, but checked
		pushSharedText('hi');
		pruneSync(new Set([A])); // B left the floor
		expect(isSyncChecked(B)).toBe(false);
		expect(isSyncChecked(A)).toBe(true);
		expect(readSharedText()).toBe('hi');
		pruneSync(new Set()); // A left too
		expect(readSharedText()).toBe('');
		expect(syncCheckedCount()).toBe(0);
	});

	it('pruneSync leaves a live check (and its text) alone', () => {
		const a = fakeMember('');
		registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		pushSharedText('still here');
		pruneSync(new Set([A, B]));
		expect(isSyncChecked(A)).toBe(true);
		expect(readSharedText()).toBe('still here');
	});

	it('resetSync clears everything', () => {
		const a = fakeMember('x');
		registerSyncMember(A, a.member);
		setSyncChecked(A, true);
		pushSharedText('y');
		resetPromptSyncForTests();
		expect(syncCheckedCount()).toBe(0);
		expect(readSharedText()).toBe('');
		expect(mirrorTextFor(A)).toBeUndefined();
	});
});
