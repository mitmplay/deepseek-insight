/**
 * Composer × swap-focus (2026-08-29): the /new successor panel's
 * composer takes the caret when it mounts — and ONLY then. focusOnMount
 * focuses the textarea once and fires onfocused (the floor clears its
 * one-shot marker on it); every ordinary mount (absent prop) leaves
 * focus alone, so a page load or restored desk never steals it.
 *
 * Harness copied from prompt-input-suggest.test.ts: component-direct
 * mount, fetch stubbed at the global seam (the app-config singleton
 * fetch never resolves — documented defaults are fine here).
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Composer from '$lib/components/composer/Composer.svelte';

vi.stubGlobal(
	'fetch',
	vi.fn(async () => new Promise<Response>(() => {}))
);

afterEach(() => {
	vi.unstubAllGlobals();
});

/** Mount one composer and return its target + unmount handle. */
function mountInput(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(Composer, {
		target,
		props: { onsubmit: () => true, oncancel: () => {}, isStreaming: false, sending: false, ...props }
	});
	flushSync();
	return {
		target,
		unmount: () => {
			unmount(instance);
			target.remove();
		}
	};
}

describe('Composer — focusOnMount (the /new swap-focus)', () => {
	it('focusOnMount: the textarea takes the caret and onfocused fires once', () => {
		const onfocused = vi.fn();
		const { target, unmount: done } = mountInput({ focusOnMount: true, onfocused });
		try {
			const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="prompt-textarea"]');
			expect(textarea).not.toBeNull();
			expect(document.activeElement).toBe(textarea);
			expect(onfocused).toHaveBeenCalledTimes(1);
		} finally {
			done();
		}
	});

	it('no focusOnMount (ordinary mount): focus stays where it was; onfocused never fires', () => {
		const onfocused = vi.fn();
		const { target, unmount: done } = mountInput({ onfocused });
		try {
			const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="prompt-textarea"]');
			expect(textarea).not.toBeNull();
			expect(document.activeElement).not.toBe(textarea);
			expect(onfocused).not.toHaveBeenCalled();
		} finally {
			done();
		}
	});
});
