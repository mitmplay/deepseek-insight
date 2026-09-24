/**
 * TerminalPanel tests (Wave 4, task 4.1-T): the disabled floor is the
 * byte-identical default, so the disabled render and the frame-state
 * reducer are the pins. EventSource/fetch are stubbed; xterm stays out of
 * the asserted path (the reducer module carries the brain).
 */
import { mount, unmount, flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TerminalPanelHost from './TerminalPanelHost.svelte';
import {
	initialTerminalPanelState,
	reduceTerminalFrame
} from '$lib/components/terminal/frame-state.js';

let enabled = false;

beforeEach(() => {
	enabled = false;
	vi.stubGlobal(
		'fetch',
		vi.fn(() => Promise.resolve(new Response(JSON.stringify({ enabled, sessions: [] }), { headers: { 'content-type': 'application/json' } })))
	);
});

describe('TerminalPanel — the disabled floor (default posture)', () => {
	it('renders the disabled message and no open terminal when the flag is off', async () => {
		const target = document.body.appendChild(document.createElement('div'));
		const app = mount(TerminalPanelHost, { target });
		flushSync();
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		const disabled = target.querySelector('[data-testid="terminal-disabled"]');
		expect(disabled).not.toBeNull();
		expect(target.querySelector('[data-testid="terminal-close"]')).toBeNull();
		expect(target.querySelector('[data-testid="terminal-opening"]')).toBeNull();
		unmount(app);
		target.remove();
	});
});

describe('terminal frame-state reducer', () => {
	it('starts honest: no settle, not closed', () => {
		expect(initialTerminalPanelState).toEqual({ lastSettle: null, closed: false, quiescent: null, errored: false });
	});

	it('the settled frame becomes the badge state, per reason', () => {
		let s = reduceTerminalFrame(initialTerminalPanelState, { event: 'settled', reason: 'stdin_read' });
		expect(s.lastSettle).toBe('stdin_read');
		s = reduceTerminalFrame(s, { event: 'settled', reason: 'timeout' });
		expect(s.lastSettle).toBe('timeout');
	});

	it('the closed frame freezes the state — late frames never unfake a dead terminal', () => {
		let s = reduceTerminalFrame(initialTerminalPanelState, { event: 'closed', quiescent: true });
		expect(s).toMatchObject({ closed: true, quiescent: true });
		expect(reduceTerminalFrame(s, { event: 'settled', reason: 'timeout' })).toBe(s);
	});

	it('an error frame flags errored without closing the stream', () => {
		const s = reduceTerminalFrame(initialTerminalPanelState, { event: 'error', error: 'NO_SESSION' });
		expect(s.errored).toBe(true);
		expect(s.closed).toBe(false);
	});
});
