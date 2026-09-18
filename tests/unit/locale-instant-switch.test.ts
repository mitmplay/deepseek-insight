/**
 * Instant-switch proof — bug-fix 2026-09-12 ("re-renders instantly" was a
 * lie: bare m.x() reads no reactive state, so labels only changed after a
 * reload). t(m.x) reads the service's tracked locale first, so a mounted
 * component MUST flip its text on setLocale with no reload and no fetch.
 * Uses the real EmptyFloor component end to end.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EmptyFloor from '$lib/components/panels/EmptyFloor.svelte';
import { setLocale, currentLocale } from '$lib/services/locale/locale-state.svelte';

function render() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(EmptyFloor, { target });
	return { target, instance };
}

afterEach(async () => {
	document.body.innerHTML = '';
	vi.restoreAllMocks();
	// reset to en for other tests in this file
	await setLocale('en');
});

describe('instant locale switch (no reload)', () => {
	it('EmptyFloor text flips on setLocale without any fetch or navigation', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const h = render();
		expect(h.target.textContent).toContain('No conversations open.');

		await setLocale('id');
		flushSync();
		expect(currentLocale()).toBe('id');
		expect(h.target.textContent).toContain('Tidak ada percakapan terbuka.');
		expect(fetchSpy).not.toHaveBeenCalled();

		await setLocale('zh');
		flushSync();
		expect(h.target.textContent).toContain('没有打开的会话。');

		await setLocale('en');
		flushSync();
		expect(h.target.textContent).toContain('No conversations open.');
		cleanup(h.instance, h.target);
	});
});

function cleanup(instance: unknown, target: HTMLElement) {
	try {
		unmount(instance as never);
	} catch {
		/* already unmounted */
	}
	target.remove();
}
