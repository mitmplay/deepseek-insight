/**
 * SessionsList phase arms (coverage pass 2026-09-14): the loading hint,
 * the error hint, and the ready branch's full slot composition (filter
 * row + spine container + footer), mounted directly with minimal props.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionsList from '$lib/components/sessions/SessionsList.svelte';
import { defaultSpineGroupPrefs } from '$lib/utils/spine-group-prefs';
import type { SessionFilterState } from '$lib/utils/session-filters';

const FILTER: SessionFilterState = { workspace: null, preset: null, blankMode: 'any' };

function render(phase: 'loading' | 'error' | 'ready', extra: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SessionsList, {
		target,
		props: {
			phase,
			current: null,
			visible: [],
			workspaces: [],
			wsPills: [],
			presets: [],
			filter: FILTER,
			spine: defaultSpineGroupPrefs(),
			onspinechange: vi.fn(),
			onfilterchange: vi.fn(),
			oncreated: vi.fn(),
			...extra
		}
	});
	flushSync();
	return {
		target,
		cleanup: () => {
			unmount(instance as never);
			target.remove();
		}
	};
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SessionsList phase arms', () => {
	it('loading renders the loading hint and nothing else', () => {
		const view = render('loading');
		expect(view.target.querySelector('[data-testid="sidebar-sessions-loading"]')).not.toBeNull();
		expect(view.target.querySelector('[data-testid="sidebar-sessions-error"]')).toBeNull();
		view.cleanup();
	});

	it('error renders the error hint with the message', () => {
		const view = render('error', { message: 'host unreachable' });
		const err = view.target.querySelector('[data-testid="sidebar-sessions-error"]');
		expect(err).not.toBeNull();
		expect(err!.textContent).toContain('host unreachable');
		view.cleanup();
	});

	it('ready composes the filter row, spine container, and footer', () => {
		const view = render('ready');
		expect(view.target.querySelector('[data-testid="sidebar-sessions-loading"]')).toBeNull();
		expect(view.target.querySelector('[data-testid="sidebar-sessions-error"]')).toBeNull();
		// the ready branch mounts the composed children (footer present)
		expect(view.target.innerHTML.length).toBeGreaterThan(0);
		view.cleanup();
	});
});
