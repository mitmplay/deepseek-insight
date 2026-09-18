/**
 * lens-context unit tests — the loupe's lens flag (The Panel Loupe ADR
 * D8, 2026-09-04):
 *  - no provider → getLensMode() reads false (every existing mount's
 *    default; the flag is context, never module state);
 *  - set-then-read round-trip inside a component tree (LensHost = the
 *    PanelLoupe provider shape, LensProbe = the controls' read point);
 *  - sibling subtrees do not leak into each other — a host that sets
 *    true never reaches a sibling mounted without a provider.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import LensHost from './LensHost.svelte';
import LensProbe from './LensProbe.svelte';

function mountInto(component: typeof LensProbe | typeof LensHost, props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(component, { target, props });
	flushSync();
	const probe = () =>
		target.querySelector('[data-testid="lens-probe"]') as HTMLElement | null;
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { probe, cleanup };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('lens-context — the loupe flag (D8)', () => {
	it('no provider reads false — the default for every existing mount', () => {
		const h = mountInto(LensProbe);
		expect(h.probe()?.getAttribute('data-lens')).toBe('false');
		h.cleanup();
	});

	it('set-then-read round-trip inside a component tree', () => {
		const h = mountInto(LensHost, { lens: true });
		expect(h.probe()?.getAttribute('data-lens')).toBe('true');
		h.cleanup();
	});

	it('sibling subtrees do not leak — one sets true, the other still reads false', () => {
		const host = mountInto(LensHost, { lens: true });
		const bare = mountInto(LensProbe);
		expect(host.probe()?.getAttribute('data-lens')).toBe('true');
		expect(bare.probe()?.getAttribute('data-lens')).toBe('false');
		host.cleanup();
		bare.cleanup();
	});
});
