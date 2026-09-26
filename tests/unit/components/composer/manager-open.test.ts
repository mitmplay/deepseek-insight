/**
 * Manager-open integration (task 3.1-T, portal leg): the strip's ⚙ row opens
 * the Prompts Manager through Composer's document.body portal host (BC-7 —
 * the modal's position:fixed must escape the panel floor's CSS zoom).
 *
 * Lives here rather than in prompts-manager.test.ts because the portal host
 * is Composer-owned: the manager-level harness mounts the modal in-tree
 * and cannot observe the body append. Close unmounts the modal.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Composer from '$lib/components/composer/Composer.svelte';

const rows = [
	{ id: 11, label: null, text: 'load project AIP, OCI', use_count: 207, last_used_at: '2026-08-28T00:00:00.000Z' }
];
const mgrRows = { rows, total: 1 };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
	fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input.toString();
		if (url.startsWith('/api/prompts?')) {
			if (url.includes('sort=')) return new Response(JSON.stringify(mgrRows), { status: 200 });
			return new Response(JSON.stringify({ results: rows }), { status: 200 });
		}
		return new Promise<Response>(() => {}); // app-config singleton: never resolves
	});
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('strip ⚙ opens the manager through the body portal', () => {
	it('?load → rows → ⚙ → .mgr-modal appears as body-portal child; close unmounts', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const c = mount(Composer, {
			target,
			props: { onsubmit: () => true, oncancel: () => {}, isStreaming: false, sending: false }
		});
		flushSync();
		const ta = target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
		ta.value = '?load';
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		await new Promise((r) => setTimeout(r, 250)); // debounce 120ms + fetch
		flushSync();
		const manage = target.querySelector('.strip-manage') as HTMLButtonElement;
		expect(manage, '⚙ row present when rows exist').not.toBeNull();
		manage.click();
		flushSync();
		await new Promise((r) => setTimeout(r, 250)); // manager refresh fetch
		const modal = document.body.querySelector('.mgr-modal');
		expect(modal, 'manager mounted').not.toBeNull();
		expect(modal!.parentElement!.parentElement).toBe(document.body); // portal host is a direct child of body
		expect(document.body.querySelector('.mgr-backdrop')).not.toBeNull();
		(document.body.querySelector('.mgr-dialog-close') as HTMLButtonElement).click();
		flushSync();
		await new Promise((r) => setTimeout(r, 100));
		expect(document.body.querySelector('.mgr-modal')).toBeNull();
		unmount(c);
		target.remove();
	});
});
