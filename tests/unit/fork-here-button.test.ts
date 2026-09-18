/**
 * ForkHereButton unit tests — the turn-level fork-here shell over the
 * shared fork spine (current disk behavior):
 *
 *   - a click POSTs the turn's ANCHOR (body {"atSeq": N}) to the fork
 *     route and locks the button (disabled + "…") until the spine resolves
 *   - success renames the child " (fork)" through the spine, opens the
 *     child AFTER its source with the chip preset, fires NO refusal
 *   - the host's refusal, an HTTP failure, and a transport error each
 *     surface VERBATIM through `onrefusal`; the lock always releases
 *   - one fork at a time: a click while locked is dropped
 */

import { flushSync } from 'svelte';
import { mount, unmount, type ComponentProps } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForkHereButton from '$lib/components/common/buttons/ForkHereButton.svelte';
import LensForkHereButtonHost from './LensForkHereButtonHost.svelte';
import {
	registerAddPanel,
	resetPanelRegistryForTests,
	type PanelAddRequest
} from '$lib/services/panels/panel-registry';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	resetPanelRegistryForTests();
	vi.unstubAllGlobals();
	fetchMock.mockReset();
	document.body.innerHTML = '';
});

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function mountButton(props: Partial<ComponentProps<typeof ForkHereButton>>) {
	const refusals: string[] = [];
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(ForkHereButton, {
		target,
		props: {
			sessionId: 'src-1',
			atSeq: 42,
			...props,
			onrefusal: (m: string) => refusals.push(m)
		} as ComponentProps<typeof ForkHereButton>
	});
	flushSync();
	return { target, refusals, comp };
}

/** Microtask-only settle — timer-agnostic. */
async function settle(): Promise<void> {
	for (let i = 0; i < 12; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

const btn = (target: HTMLElement): HTMLButtonElement =>
	target.querySelector('[data-testid="fork-here-button"]') as HTMLButtonElement;

describe('ForkHereButton — idle render', () => {
	it('renders the row-chip button idle: GitBranch icon, honest title, enabled', () => {
		const { target, refusals, comp } = mountButton({ class: 'mx-1' });
		const button = btn(target);
		expect(button).not.toBeNull();
		expect(button.getAttribute('aria-label')).toBe('Fork from this turn');
		expect(button.getAttribute('title')).toContain('Fork from this turn');
		expect(button.disabled).toBe(false);
		expect(button.className).toContain('shrink-0');
		expect(button.className).toContain('mx-1');
		expect(button.querySelector('svg')).not.toBeNull();
		expect(target.textContent?.trim()).not.toBe('…');
		expect(refusals).toEqual([]);
		unmount(comp);
	});

	it('an omitted class still carries the shell classes, never the string "undefined"', () => {
		const { target, comp } = mountButton({});
		expect(btn(target).className).toContain('shrink-0');
		expect(btn(target).className).not.toContain('undefined');
		unmount(comp);
	});
});

describe('ForkHereButton — the fork click', () => {
	it('click POSTs the turn anchor body {"atSeq": N} and passes title + preset to the spine', async () => {
		const added: PanelAddRequest[] = [];
		registerAddPanel((req) => added.push(req));
		fetchMock.mockImplementation(async (url: URL | Request | string) =>
			String(url).endsWith('/rename')
				? jsonRes({ ok: true, title: 'Loader (fork)' })
				: jsonRes({ ok: true, sessionId: 'child-1' })
		);
		const { target, refusals, comp } = mountButton({ title: 'Loader', agentPreset: 'planner' });
		btn(target).click();
		await settle();
		const forkCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/fork'));
		expect(forkCall).toBeDefined();
		expect(String(forkCall?.[0])).toBe('/api/dsh/session/src-1/fork');
		expect(JSON.parse(String(forkCall?.[1]?.body))).toEqual({ atSeq: 42 });
		// the child is renamed " (fork)" with the live source title
		const renameCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/rename'));
		expect(renameCall).toBeDefined();
		expect(JSON.parse(String(renameCall?.[1]?.body))).toEqual({ title: 'Loader (fork)' });
		// the child opens AFTER ITS SOURCE with the chip preset
		expect(added).toHaveLength(1);
		expect(added[0]).toEqual({
			sessionId: 'child-1',
			agentPreset: 'planner',
			focus: true,
			afterSessionId: 'src-1'
		});
		expect(refusals).toEqual([]);
		expect(btn(target).disabled).toBe(false);
		unmount(comp);
	});

	it('no title → no rename POST (nothing to disambiguate)', async () => {
		registerAddPanel(vi.fn());
		fetchMock.mockImplementation(async () => jsonRes({ ok: true, sessionId: 'child-1' }));
		const { target, comp } = mountButton({});
		btn(target).click();
		await settle();
		expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/rename'))).toHaveLength(0);
		unmount(comp);
	});
});

describe('ForkHereButton — the busy lock', () => {
	it('in-flight: disabled with "…"; a second fork is dropped; the lock releases', async () => {
		registerAddPanel(vi.fn());
		let resolveFetch!: (r: Response) => void;
		const gate = new Promise<Response>((resolve) => {
			resolveFetch = resolve;
		});
		fetchMock.mockImplementation(() => gate);
		const { target, refusals, comp } = mountButton({});
		// Two clicks in the SAME synchronous turn: the second enters fork()
		// while `forking` is already true — the in-code lock drops it before
		// any fetch (the disabled attribute only lands on the next flush,
		// and happy-dom swallows clicks dispatched at disabled buttons).
		btn(target).click();
		btn(target).click();
		flushSync();
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(btn(target).disabled).toBe(true);
		expect(target.textContent?.trim()).toBe('…');
		resolveFetch(jsonRes({ ok: true, sessionId: 'child-1' }));
		await settle();
		expect(btn(target).disabled).toBe(false);
		expect(target.textContent?.trim()).not.toBe('…');
		expect(btn(target).querySelector('svg')).not.toBeNull();
		expect(refusals).toEqual([]);
		unmount(comp);
	});
});

describe('ForkHereButton — refusal surfacing', () => {
	it('a host refusal reaches onrefusal VERBATIM and the lock releases', async () => {
		const { target, refusals, comp } = mountButton({});
		fetchMock.mockImplementation(async () =>
			jsonRes({ ok: false, error: { message: 'source has an open turn' } })
		);
		btn(target).click();
		await settle();
		expect(refusals).toEqual(['source has an open turn']);
		expect(btn(target).disabled).toBe(false);
		unmount(comp);
	});

	it('a non-JSON HTTP failure surfaces the status message', async () => {
		const { target, refusals, comp } = mountButton({});
		fetchMock.mockResolvedValue(new Response('gateway down', { status: 503 }));
		btn(target).click();
		await settle();
		expect(refusals).toEqual(['fork failed (HTTP 503)']);
		expect(btn(target).disabled).toBe(false);
		unmount(comp);
	});

	it('a transport failure surfaces the error message', async () => {
		const { target, refusals, comp } = mountButton({});
		fetchMock.mockRejectedValue(new Error('host unreachable'));
		btn(target).click();
		await settle();
		expect(refusals).toEqual(['host unreachable']);
		expect(btn(target).disabled).toBe(false);
		unmount(comp);
	});
});

describe('ForkHereButton — the lens disable (Panel Loupe D8, 2026-09-04)', () => {
	/** Mount the button inside a lens tree (the LensForkHereButtonHost
	 *  fixture = the PanelLoupe provider shape). */
	function mountLensButton(props: Record<string, unknown> = {}) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(LensForkHereButtonHost, {
			target,
			props: { sessionId: 'src-1', atSeq: 42, ...props }
		});
		flushSync();
		return { target, comp };
	}

	it('a lens-tree mount renders the button visible and disabled; a forced click never reaches the spine', async () => {
		registerAddPanel(vi.fn());
		fetchMock.mockImplementation(async () => jsonRes({ ok: true, sessionId: 'child-1' }));
		const { target, comp } = mountLensButton();
		const button = btn(target);
		expect(button).not.toBeNull(); // visible — the verb renders whole
		expect(button.disabled).toBe(true); // the real attribute, D8's contract
		button.click(); // happy-dom swallows clicks at disabled buttons
		await settle();
		expect(fetchMock).not.toHaveBeenCalled(); // forkFromSession never fired
		unmount(comp);
	});

	it('a lens-tree mount with lens false renders enabled (the control arm)', () => {
		const { target, comp } = mountLensButton({ lens: false });
		expect(btn(target).disabled).toBe(false);
		unmount(comp);
	});
});
