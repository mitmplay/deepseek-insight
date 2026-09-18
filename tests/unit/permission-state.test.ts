/**
 * permission-state unit tests (ADR-0007, 2026-08-25).
 *
 * Three contracts, mirroring the module's three consumers:
 *
 *   1. The fold (pure, DSH parity): preset-wins-while-matching, table
 *      match, custom, partial-triple honesty (undefined, never a guess).
 *   2. The projections ingest: host wire value → chip read state, custom
 *      filtered, labels sugared, malformed input declines to undefined.
 *   3. The store integration: seed (baseline + knob events) → poll
 *      deltas accumulate → derived read state hides without truth.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
	EMPTY_KNOBS,
	applyKnobEvent,
	filterKnobEvents,
	foldKnobs,
	localPermission,
	permissionFromProjection,
	presetLabel,
	resolvePermission,
	type DsiPermission,
	type KnobState
} from '$lib/services/conversation/permission-state';
import { createConversationStore } from '$lib/services/conversation/store.svelte';
import type { DshRawEvent } from '$lib/services/conversation/dsh-events';

function ev(type: string, data: Record<string, unknown>, seq = 1): DshRawEvent {
	return { type, seq, time: seq * 1000, data };
}

/** A complete DSH preset pick: three knob events, one turn. */
function pick(preset: string, sandbox: string, approval: string, from = 1): DshRawEvent[] {
	return [
		ev('permission/preset', { preset }, from),
		ev('sandbox/mode', { mode: sandbox }, from + 1),
		ev('approval/policy', { policy: approval }, from + 2)
	];
}

describe('permission-state — the fold (DSH parity)', () => {
	it('empty knob state resolves undefined — no basis, never a guess', () => {
		expect(resolvePermission(EMPTY_KNOBS)).toBeUndefined();
		expect(foldKnobs([])).toEqual(EMPTY_KNOBS);
	});

	it('a picked preset wins while its knobs still agree', () => {
		const knobs = foldKnobs(pick('read-only', 'read-only', 'ask'));
		expect(knobs).toEqual<KnobState>({ preset: 'read-only', sandbox: 'read-only', approval: 'ask' });
		expect(resolvePermission(knobs)).toBe('read-only');
	});

	it('a drifted knob demotes the picked preset to the table match', () => {
		// picked read-only, then the sandbox knob moved to workspace-write
		const knobs = foldKnobs([...pick('read-only', 'read-only', 'ask'), ev('sandbox/mode', { mode: 'workspace-write' }, 9)]);
		expect(resolvePermission(knobs)).toBe('workspace-write');
	});

	it('a complete triple matching no entry resolves custom', () => {
		const knobs = foldKnobs([ev('sandbox/mode', { mode: 'read-only' }, 1), ev('approval/policy', { policy: 'never' }, 2)]);
		expect(resolvePermission(knobs)).toBe('custom');
	});

	it('a partial triple with no match resolves undefined — the baseline stands', () => {
		// only the sandbox knob is known: table match needs both
		expect(resolvePermission({ preset: null, sandbox: 'danger-full-access', approval: null })).toBeUndefined();
		// unknown preset name + one knob: no preset spec, no table basis
		expect(resolvePermission({ preset: 'custom-deploy-preset', sandbox: null, approval: 'ask' })).toBeUndefined();
	});

	it('applyKnobEvent is reference-stable for non-knob events (change gate)', () => {
		const state: KnobState = { preset: 'read-only', sandbox: 'read-only', approval: 'ask' };
		expect(applyKnobEvent(state, ev('user/message', { content: [] }, 5))).toBe(state);
		expect(applyKnobEvent(state, ev('permission/preset', {}, 6))).toBe(state); // malformed payload — same ref
	});

	it('an unknown preset name with matching knobs resolves through the table (R6 degrade)', () => {
		// a deployment-configured preset the local table does not know
		const knobs = foldKnobs(pick('custom-deploy-preset', 'workspace-write', 'ask'));
		// preset spec unknown → table match on the knobs
		expect(resolvePermission(knobs)).toBe('workspace-write');
	});

	it('filterKnobEvents keeps only the three knob types', () => {
		const window = [...pick('read-only', 'read-only', 'ask'), ev('user/message', { content: [] }, 9), ev('tool/call', { callId: 'c1' }, 10)];
		expect(filterKnobEvents(window).map((e) => e.type)).toEqual([
			'permission/preset',
			'sandbox/mode',
			'approval/policy'
		]);
	});

	it('label transform: Title Case, the pinned Full access product label, raw pass-through', () => {
		expect(presetLabel('workspace-write')).toBe('Workspace Write');
		expect(presetLabel('danger-full-access')).toBe('Full access');
		expect(presetLabel('custom')).toBe('Custom');
		expect(presetLabel('read-only')).toBe('Read Only');
		expect(presetLabel('Custom Deploy Preset')).toBe('Custom Deploy Preset'); // non-kebab passes through
	});
});

describe('permission-state — projections ingest', () => {
	it('a valid host value becomes the chip read state (custom filtered, labels sugared)', () => {
		const raw = {
			options: [
				{ value: 'read-only', name: 'read-only', description: 'Look, do not touch.' },
				{ value: 'workspace-write', name: 'workspace-write' },
				{ value: 'danger-full-access', name: 'danger-full-access', description: 'Everything, no asks.' },
				{ value: 'custom', name: 'Custom' } // appended while current — never switchable
			],
			currentValue: 'workspace-write'
		};
		const permission = permissionFromProjection(raw);
		expect(permission).toBeDefined();
		expect(permission!.current).toBe('workspace-write');
		expect(permission!.options.map((o) => o.value)).toEqual(['read-only', 'workspace-write', 'danger-full-access']);
		expect(permission!.options.map((o) => o.label)).toEqual(['Read Only', 'Workspace Write', 'Full access']);
		expect(permission!.options[0].description).toBe('Look, do not touch.');
		expect(permission!.options[1].description).toBeUndefined();
	});

	it('custom may be the current value — readable, still not among the options', () => {
		const permission = permissionFromProjection({
			options: [
				{ value: 'workspace-write', name: 'workspace-write' },
				{ value: 'custom', name: 'Custom' }
			],
			currentValue: 'custom'
		});
		expect(permission!.current).toBe('custom');
		expect(permission!.options.some((o) => o.value === 'custom')).toBe(false);
	});

	it('malformed values decline to undefined — the chip hides, never guesses', () => {
		expect(permissionFromProjection(undefined)).toBeUndefined();
		expect(permissionFromProjection(null)).toBeUndefined();
		expect(permissionFromProjection('workspace-write')).toBeUndefined();
		expect(permissionFromProjection({ options: [], currentValue: 'x' })).toBeUndefined(); // empty options
		expect(permissionFromProjection({ options: [{ value: 'read-only' }] })).toBeUndefined(); // no current
	});

	it('localPermission carries the shipped trio in table order', () => {
		const local = localPermission();
		expect(local.current).toBe('workspace-write');
		expect(local.options.map((o) => o.value)).toEqual(['read-only', 'workspace-write', 'danger-full-access']);
	});
});

describe('permission-state — store integration (ADR-0007 R2)', () => {
	let store: ReturnType<typeof createConversationStore>;

	beforeEach(() => {
		store = createConversationStore('s-1');
	});

	it('no baseline + no knob events → permission null (chip hidden)', () => {
		expect(store.permission).toBeNull();
	});

	it('baseline alone stands: the projections value is the read state', () => {
		const baseline = permissionFromProjection({
			options: [{ value: 'read-only', name: 'read-only' }, { value: 'workspace-write', name: 'workspace-write' }],
			currentValue: 'read-only'
		});
		store.seedPermission(baseline);
		expect(store.permission).toEqual<DsiPermission>({
			current: 'read-only',
			options: [
				{ value: 'read-only', label: 'Read Only' },
				{ value: 'workspace-write', label: 'Workspace Write' }
			]
		});
	});

	it('knob events without a baseline resolve through the local table', () => {
		store.seedPermission(null, pick('danger-full-access', 'danger-full-access', 'never'));
		expect(store.permission?.current).toBe('danger-full-access');
		expect(store.permission?.options).toEqual(localPermission().options);
	});

	it('poll deltas accumulate: a pick made elsewhere advances the read state', () => {
		store.seedPermission(permissionFromProjection({
			options: [{ value: 'workspace-write', name: 'workspace-write' }],
			currentValue: 'workspace-write'
		}));
		// someone switched the mode in DSH's own UI — the delta carries the 3 events
		store.applyPoll({
			entries: [],
			lastSeq: 10,
			running: false,
			knobEvents: pick('read-only', 'read-only', 'ask', 11)
		});
		expect(store.permission?.current).toBe('read-only');
	});

	it('the folded triple outranks a stale baseline (newer events win)', () => {
		store.seedPermission(
			permissionFromProjection({ options: [{ value: 'workspace-write', name: 'workspace-write' }], currentValue: 'workspace-write' }),
			pick('read-only', 'read-only', 'ask')
		);
		// baseline says workspace-write but the window's own events say read-only
		expect(store.permission?.current).toBe('read-only');
	});

	it('resync re-seeds authoritatively (baseline + window)', () => {
		store.applyKnobEvents(pick('read-only', 'read-only', 'ask'));
		store.resyncFromLedgerEntries([], 5, false, {
			permission: permissionFromProjection({
				options: [{ value: 'workspace-write', name: 'workspace-write' }],
				currentValue: 'workspace-write'
			}),
			knobEvents: []
		});
		expect(store.permission?.current).toBe('workspace-write');
	});

	it('a pick POSTs nothing client-side — confirmation is the poll fold (idempotent retransmits)', () => {
		store.seedPermission(null, pick('workspace-write', 'workspace-write', 'ask'));
		const delta = pick('read-only', 'read-only', 'ask', 11);
		store.applyPoll({ entries: [], lastSeq: 13, running: false, knobEvents: delta });
		store.applyPoll({ entries: [], lastSeq: 13, running: false, knobEvents: delta }); // retransmit
		expect(store.permission?.current).toBe('read-only');
	});
});
