/**
 * NewChatButton unit tests — the dual-verb create button. The shared
 * create routine: missing-selection alert (its clear on the next armed
 * click, its × dismiss), the `creating` flight state, inline error
 * surfaces for refused/failed creates and network failures,
 * `agentPreset ?? null` normalization on success, and the verb dispatch —
 * Add by default, Replace via the segmented toggle (which only renders
 * with `onreplace`). Also pins the compact chrome variant.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewChatButton from '$lib/components/composer/NewChatButton.svelte';

/** NewChatButton's prop shape (inline — svelte-check's ComponentProps drifts). */
type NewChatProps = {
	oncreated: (sessionId: string, agentPreset: string | null) => void;
	onreplace?: ((sessionId: string, agentPreset: string | null) => void) | null;
	agent?: string | null;
	workspace?: string | null;
	compact?: boolean;
};

function jsonResponse(body: string, status = 200): Response {
	return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(impl: (input: string, init?: RequestInit) => Promise<Response>): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(impl);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function mountButton(props: NewChatProps) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(NewChatButton, { target, props });
	flushSync();
	return { target, instance };
}

function button(target: HTMLElement): HTMLButtonElement {
	return target.querySelector<HTMLButtonElement>('[data-testid="new-chat-button"]')!;
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('NewChatButton — shared guards', () => {
	it('an unselected agent shows the alert and never fetches', async () => {
		const fetchMock = stubFetch(() => Promise.reject(new Error('must not be called')));
		const oncreated = vi.fn();
		const { target, instance } = mountButton({ oncreated });
		button(target).click();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="new-chat-selection-alert"]')).not.toBeNull();
		});
		expect(fetchMock).not.toHaveBeenCalled();
		expect(oncreated).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('the alert clears on the next armed click', async () => {
		stubFetch(() => Promise.resolve(jsonResponse('{ "ok": true, "sessionId": "s1" }')));
		const oncreated = vi.fn();
		const { target, instance } = mountButton({ oncreated });
		button(target).click();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="new-chat-selection-alert"]')).not.toBeNull();
		});
		// Arm both pills and click again…
		unmount(instance);
		const armed = mountButton({
			oncreated,
			agent: 'app-dev',
			workspace: '/tmp/ws'
		});
		button(armed.target).click();
		await vi.waitFor(() => expect(oncreated).toHaveBeenCalledOnce());
		flushSync();
		expect(armed.target.querySelector('[data-testid="new-chat-selection-alert"]')).toBeNull();
		unmount(armed.instance);
	});

	it('an unselected workspace still creates — the body omits cwd entirely', async () => {
		const fetchMock = stubFetch(() => Promise.resolve(jsonResponse('{ "ok": true, "sessionId": "s1" }')));
		const oncreated = vi.fn();
		const { target, instance } = mountButton({ oncreated, agent: 'app-dev' });
		button(target).click();
		await vi.waitFor(() => expect(oncreated).toHaveBeenCalledOnce());
		const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>;
		expect(body).toEqual({ agentPreset: 'app-dev' });
		unmount(instance);
	});

	it("the alert's × dismiss hides it without arming the pills", async () => {
		const fetchMock = stubFetch(() => Promise.reject(new Error('must not be called')));
		const oncreated = vi.fn();
		const { target, instance } = mountButton({ oncreated });
		button(target).click();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="new-chat-selection-alert"]')).not.toBeNull();
		});
		target.querySelector<HTMLButtonElement>('[data-testid="new-chat-selection-alert-close"]')!.click();
		flushSync();
		expect(target.querySelector('[data-testid="new-chat-selection-alert"]')).toBeNull();
		// Dismissal only hides the message — the next unarmed click re-raises it.
		button(target).click();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="new-chat-selection-alert"]')).not.toBeNull();
		});
		expect(fetchMock).not.toHaveBeenCalled();
		expect(oncreated).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('the button parks in flight: "Creating…" + disabled', async () => {
		stubFetch(() => new Promise(() => {})); // never settles — the flight persists
		const { target, instance } = mountButton({
			oncreated: vi.fn(),
			agent: 'app-dev',
			workspace: '/tmp/ws'
		});
		button(target).click();
		await vi.waitFor(() => expect(button(target).disabled).toBe(true));
		expect(button(target).textContent).toContain('Creating…');
		unmount(instance);
	});
});

describe('NewChatButton — create outcomes', () => {
	it('success dispatches oncreated with the fresh id and the host preset', async () => {
		const fetchMock = stubFetch(() =>
			Promise.resolve(jsonResponse('{ "ok": true, "sessionId": "s1", "agentPreset": "research" }'))
		);
		const oncreated = vi.fn();
		const { target, instance } = mountButton({
			oncreated,
			agent: 'research',
			workspace: '/tmp/ws'
		});
		button(target).click();
		await vi.waitFor(() => expect(oncreated).toHaveBeenCalledOnce());
		expect(oncreated).toHaveBeenCalledWith('s1', 'research');
		expect(fetchMock).toHaveBeenCalledWith('/api/dsh/sessions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ agentPreset: 'research', cwd: '/tmp/ws' })
		});
		unmount(instance);
	});

	it('a create response without agentPreset normalizes it to null', async () => {
		stubFetch(() => Promise.resolve(jsonResponse('{ "ok": true, "sessionId": "s2" }')));
		const oncreated = vi.fn();
		const { target, instance } = mountButton({
			oncreated,
			agent: 'app-dev',
			workspace: '/tmp/ws'
		});
		button(target).click();
		await vi.waitFor(() => expect(oncreated).toHaveBeenCalledOnce());
		expect(oncreated).toHaveBeenCalledWith('s2', null);
		unmount(instance);
	});

	it('a refused create (error body) shows the host message inline and stays put', async () => {
		stubFetch(() =>
			Promise.resolve(
				jsonResponse('{ "ok": false, "error": { "code": "x", "message": "unknown preset" } }', 502)
			)
		);
		const oncreated = vi.fn();
		const { target, instance } = mountButton({
			oncreated,
			agent: 'ghost',
			workspace: '/tmp/ws'
		});
		button(target).click();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="new-chat-error"]')?.textContent).toBe(
				'unknown preset'
			);
		});
		expect(oncreated).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('a failure body without an error message falls back to the status code', async () => {
		stubFetch(() => Promise.resolve(jsonResponse('{ "ok": false }', 500)));
		const oncreated = vi.fn();
		const { target, instance } = mountButton({
			oncreated,
			agent: 'app-dev',
			workspace: '/tmp/ws'
		});
		button(target).click();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="new-chat-error"]')?.textContent).toBe(
				'create failed (500)'
			);
		});
		expect(oncreated).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('a network failure surfaces the transport error inline', async () => {
		stubFetch(() => Promise.reject(new Error('mux dropped')));
		const oncreated = vi.fn();
		const { target, instance } = mountButton({
			oncreated,
			agent: 'app-dev',
			workspace: '/tmp/ws'
		});
		button(target).click();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="new-chat-error"]')?.textContent).toBe('mux dropped');
		});
		expect(oncreated).not.toHaveBeenCalled();
		unmount(instance);
	});
});

describe('NewChatButton — the Add | Replace verb toggle', () => {
	it('without onreplace there is no toggle (the home-page shape)', () => {
		const { target, instance } = mountButton({ oncreated: vi.fn() });
		expect(target.querySelector('[data-testid="chat-mode-toggle"]')).toBeNull();
		expect(button(target).textContent).toContain('+ New chat');
		unmount(instance);
	});

	it('with onreplace the toggle renders; Replace flips the label and the dispatch', async () => {
		stubFetch(() => Promise.resolve(jsonResponse('{ "ok": true, "sessionId": "s3" }')));
		const oncreated = vi.fn();
		const onreplace = vi.fn();
		const { target, instance } = mountButton({
			oncreated,
			onreplace,
			agent: 'app-dev',
			workspace: '/tmp/ws'
		});
		const toggle = target.querySelector('[data-testid="chat-mode-toggle"]')!;
		expect(toggle).not.toBeNull();

		const replaceSeg = target.querySelector<HTMLButtonElement>('[data-testid="chat-mode-replace"]')!;
		expect(replaceSeg.getAttribute('aria-pressed')).toBe('false');
		replaceSeg.click();
		flushSync();
		expect(button(target).textContent).toContain('Replace chat');
		expect(replaceSeg.getAttribute('aria-pressed')).toBe('true');

		button(target).click();
		await vi.waitFor(() => expect(onreplace).toHaveBeenCalledOnce());
		expect(onreplace).toHaveBeenCalledWith('s3', null);
		expect(oncreated).not.toHaveBeenCalled();

		// Back to Add: the dispatch returns to oncreated and the label follows.
		target.querySelector<HTMLButtonElement>('[data-testid="chat-mode-add"]')!.click();
		flushSync();
		expect(button(target).textContent).toContain('+ New chat');
		unmount(instance);
	});
});

describe('NewChatButton — chrome variants', () => {
	it('the default chrome is the full-width column (alert spans the sides)', () => {
		const { target, instance } = mountButton({ oncreated: vi.fn() });
		expect(target.firstElementChild?.className).toBe('flex w-full flex-col items-start');
		unmount(instance);
	});

	it('compact keeps the full-width footer shape', () => {
		const { target, instance } = mountButton({ oncreated: vi.fn(), compact: true });
		expect(target.firstElementChild?.className).toBe('flex w-full flex-col items-start');
		expect(button(target).className).toContain('flex-1');
		unmount(instance);
	});
});
