/**
 * Reload blob sanitize (the Reload Rememberer ADR D3, shape pinned
 * 2026-09-23): the skill-shelf whitelist admits only a well-formed
 * loading (numeric startedAt) or an unexpired done (numeric startedAt
 * AND doneAt). Everything else — junk, the legacy `state`-keyed blob,
 * an expired done, a missing startedAt — clears to idle (null).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPanelPrefs, savePanelPrefs } from '$lib/utils/panel-prefs';

const T0 = 1_700_000_000_000;

function storedReload(reload: unknown): unknown {
	savePanelPrefs({
		panels: [{ id: 's', kind: 'skill-shelf', width: 480, reload } as never],
		selectedPanelId: 's',
		panelWidth: 730,
		zoom: 1
	});
	return (loadPanelPrefs().panels[0] as { reload: unknown }).reload;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(T0);
	localStorage.clear();
});

afterEach(() => {
	vi.useRealTimers();
	localStorage.clear();
});

describe('reload blob sanitize — what survives the whitelist', () => {
	it('a well-formed loading survives with its startedAt', () => {
		expect(storedReload({ phase: 'loading', startedAt: T0 - 100 })).toEqual({
			phase: 'loading',
			startedAt: T0 - 100
		});
	});

	it('an unexpired done survives with startedAt and doneAt', () => {
		expect(
			storedReload({ phase: 'done', startedAt: T0 - 2_000, doneAt: T0 + 3_000 })
		).toEqual({ phase: 'done', startedAt: T0 - 2_000, doneAt: T0 + 3_000 });
	});

	it('an expired done falls to null', () => {
		expect(
			storedReload({ phase: 'done', startedAt: T0 - 9_000, doneAt: T0 - 1 })
		).toBeNull();
	});

	it('a done at the exact expiry boundary is expired', () => {
		expect(
			storedReload({ phase: 'done', startedAt: T0 - 5_000, doneAt: T0 })
		).toBeNull();
	});

	it('the legacy state-keyed blob falls to null (forward cleanup)', () => {
		expect(storedReload({ state: 'loading' })).toBeNull();
		expect(storedReload({ state: 'done', doneAt: T0 + 9_999 })).toBeNull();
	});

	it('a missing startedAt makes ANY phase fall to null', () => {
		expect(storedReload({ phase: 'loading' })).toBeNull();
		expect(storedReload({ phase: 'done', doneAt: T0 + 9_999 })).toBeNull();
	});

	it('junk shapes fall to null', () => {
		expect(storedReload(null)).toBeNull();
		expect(storedReload(undefined)).toBeNull();
		expect(storedReload('loading')).toBeNull();
		expect(storedReload(42)).toBeNull();
		expect(storedReload({ phase: 'idle', startedAt: T0 })).toBeNull();
	});
});
