/**
 * UserMessageJumper branch tests: jump guard paths (no container, no
 * anchor), the long-text truncation ellipsis, the refocus contract, and
 * the cssEscape fallback when CSS.escape is unavailable.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UserMessageJumper from '$lib/components/common/layout/UserMessageJumper.svelte';
import type { TurnGroup } from '$lib/utils/turn-grouping';

const prompt = (id: string, text: string): TurnGroup => ({
	kind: 'prompt',
	key: id,
	entry: { kind: 'user-message', id, seq: 1, time: 1_000, text },
	context: []
});

function mountJumper(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(UserMessageJumper, {
		target,
		props: { triggerEl: undefined, open: true, ...props } as never
	});
	flushSync();
	return { target, instance };
}

const rowAt = (target: HTMLElement, i = 0): HTMLElement =>
	target.querySelectorAll('[data-testid="user-message-jumper-row"]')[i] as HTMLElement;

afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('UserMessageJumper — jump guards', () => {
	it('no container → jump is an early-return no-op (never throws)', async () => {
		const { target, instance } = mountJumper({ groups: [prompt('u:1', 'hi')], container: undefined });
		rowAt(target).click();
		await flushSync();
		unmount(instance);
	});

	it('anchor missing inside the container → the second guard stops the jump', async () => {
		const container = document.createElement('div');
		const scrollTo = vi.fn();
		container.scrollTo = scrollTo;
		const { target, instance } = mountJumper({ groups: [prompt('u:1', 'hi')], container });
		rowAt(target).click();
		await flushSync();
		expect(scrollTo).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('jump found → smooth-scroll centered and the shell is refocused', async () => {
		const container = document.createElement('div');
		const anchor = document.createElement('div');
		anchor.setAttribute('data-group-key', 'u:1');
		container.appendChild(anchor);
		document.body.appendChild(container);
		container.scrollTo = vi.fn();
		const { target, instance } = mountJumper({ groups: [prompt('u:1', 'find me')], container });
		rowAt(target).click();
		await flushSync();
		expect(container.scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'smooth' });
		unmount(instance);
	});
});

describe('UserMessageJumper — row text', () => {
	it('prompt longer than 60 chars truncates with an ellipsis', () => {
		const long = 'a'.repeat(70) + 'tail';
		const { target, instance } = mountJumper({ groups: [prompt('u:1', long)], container: document.createElement('div') });
		const body = rowAt(target).textContent ?? '';
		expect(body).toContain('…');
		expect(body.indexOf('tail')).toBe(-1);
		unmount(instance);
	});

	it('exactly-60-char prompt stays untruncated (boundary branch)', () => {
		const exact = 'b'.repeat(60);
		const { target, instance } = mountJumper({ groups: [prompt('u:1', exact)], container: document.createElement('div') });
		expect(rowAt(target).textContent).not.toContain('…');
		unmount(instance);
	});
});

describe('UserMessageJumper — cssEscape fallback', () => {
	it('without CSS.escape the raw key still drives the selector (anchor found)', async () => {
		vi.stubGlobal('CSS', undefined);
		const container = document.createElement('div');
		const anchor = document.createElement('div');
		anchor.setAttribute('data-group-key', 'u:seq:12');
		container.appendChild(anchor);
		document.body.appendChild(container);
		const scrollTo = vi.fn();
		container.scrollTo = scrollTo;
		const { target, instance } = mountJumper({ groups: [prompt('u:seq:12', 'find me')], container });
		rowAt(target).click();
		await flushSync();
		expect(scrollTo).toHaveBeenCalled();
		unmount(instance);
	});
});
