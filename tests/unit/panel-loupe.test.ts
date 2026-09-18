/**
 * PanelLoupe unit tests — the loupe dialog shell (The Panel Loupe ADR
 * D2/D8, 2026-09-04; image-lightbox.test.ts is the contract donor's
 * pin and this file's pattern):
 *  - dismissal: Escape, a mask mousedown, and the × control each close
 *    once; a non-Escape key does nothing;
 *  - portal: the dialog's parent is document.body (outside the mount
 *    target — the PanelsZoom transform trap, D2), removed on unmount;
 *  - focus: moves to the × on open, returns to the opener on unmount;
 *  - identity: role="dialog" + aria-modal="true", the session id hook;
 *    the label variant (The Loupe for Every Panel, 2026-09-08): a
 *    non-conversation lens renders the title header, no copy-id;
 *  - the lens flag (D8): a component inside the children snippet reads
 *    lens=true through the portal; a composer body mounts the sync
 *    check visible-disabled, the header's chevrons/close disabled, and
 *    the lens × enabled.
 */
import { createRawSnippet, flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PanelLoupe from '$lib/components/panels/PanelLoupe.svelte';
import LensLoupeProbeBody from './LensLoupeProbeBody.svelte';
import LensLoupeComposerBody from './LensLoupeComposerBody.svelte';

beforeEach(() => {
	// Stubbed per test (not once per file): the composer fixture's
	// loadAppConfig singleton must be created under the stub — an
	// unstubbed first mount would reach the network.
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Promise<Response>(() => {}))
	);
	localStorage.clear();
});

function bodySnippet() {
	return createRawSnippet(() => ({ render: () => '<div data-testid="loupe-body">panel body</div>' }));
}

function mountLoupe(onclose: () => void) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PanelLoupe, {
		target,
		props: { panelId: 'p1', sessionId: 's-1', onclose, children: bodySnippet() }
	});
	flushSync();
	return { target, instance };
}

const root = (): HTMLElement =>
	document.querySelector('[data-testid="panel-loupe"]') as HTMLElement;

const inRoot = (id: string): HTMLElement | null =>
	root()?.querySelector(`[data-testid="${id}"]`) ?? null;

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('PanelLoupe — focus fallback (2026-09-05)', () => {
	it('a non-HTMLElement activeElement at open is tolerated (no opener restore, no throw)', () => {
		const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement');
		Object.defineProperty(document, 'activeElement', {
			configurable: true,
			get: () => ({ fake: true }) as unknown as Element | null
		});
		try {
			const onclose = vi.fn();
			const { instance } = mountLoupe(onclose);
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
			flushSync();
			expect(onclose).toHaveBeenCalledOnce();
			expect(() => unmount(instance)).not.toThrow();
		} finally {
			if (desc) Object.defineProperty(Document.prototype, 'activeElement', desc);
			else delete (document as unknown as { activeElement?: unknown }).activeElement;
		}
	});
});

describe('PanelLoupe — dismissal (the donor contract)', () => {
	it('Escape closes once; a non-Escape key does nothing', () => {
		const onclose = vi.fn();
		const { instance } = mountLoupe(onclose);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
		flushSync();
		expect(onclose).not.toHaveBeenCalled();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(onclose).toHaveBeenCalledOnce();
		unmount(instance);
	});

	it('a mask mousedown closes once', () => {
		const onclose = vi.fn();
		const { instance } = mountLoupe(onclose);
		inRoot('panel-loupe-mask')?.dispatchEvent(
			// bubbles: true — Svelte's delegated listeners live at the document root.
			new MouseEvent('mousedown', { bubbles: true })
		);
		expect(onclose).toHaveBeenCalledOnce();
		unmount(instance);
	});

	it('the × control closes once', () => {
		const onclose = vi.fn();
		const { instance } = mountLoupe(onclose);
		(inRoot('panel-loupe-close') as HTMLElement).click();
		expect(onclose).toHaveBeenCalledOnce();
		unmount(instance);
	});
});

describe('PanelLoupe — portal, focus, identity', () => {
	it('portals the dialog to document.body (not the mount target) and removes it on unmount', () => {
		const { target, instance } = mountLoupe(vi.fn());
		expect(root()).not.toBeNull();
		expect(root().parentElement).toBe(document.body);
		expect(root().parentElement).not.toBe(target);
		expect(root().getAttribute('role')).toBe('dialog');
		expect(root().getAttribute('aria-modal')).toBe('true');
		expect(root().getAttribute('data-session-id')).toBe('s-1');
		unmount(instance);
		expect(document.querySelector('[data-testid="panel-loupe"]')).toBeNull();
	});

	it('the label variant: a manager lens renders the title header, no copy-id (The Loupe for Every Panel)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelLoupe, {
			target,
			props: {
				panelId: 'm1',
				sessionId: '',
				label: 'Prompt Manager',
				onclose: vi.fn(),
				children: bodySnippet()
			}
		});
		flushSync();
		expect(inRoot('panel-header-label')?.textContent).toContain('Prompt Manager');
		expect(inRoot('panel-header-copy-id')).toBeNull();
		unmount(instance);
		expect(document.querySelector('[data-testid="panel-loupe"]')).toBeNull();
	});

	it('focus moves to the × control on open (happy-dom cannot focus buttons — spy the call)', () => {
		const focusSpy = vi.spyOn(HTMLButtonElement.prototype, 'focus').mockImplementation(() => {});
		try {
			const { instance } = mountLoupe(vi.fn());
			flushSync();
			expect(focusSpy).toHaveBeenCalled();
			unmount(instance);
		} finally {
			focusSpy.mockRestore();
		}
	});

	it('focus returns to the opener on unmount', () => {
		const opener = document.createElement('input');
		document.body.appendChild(opener);
		// happy-dom's activeElement tracking is unreliable — pin it to the
		// opener so the effect's opener snapshot is deterministic.
		Object.defineProperty(document, 'activeElement', { configurable: true, get: () => opener });
		try {
			const openerFocus = vi.spyOn(opener, 'focus');
			const { instance } = mountLoupe(vi.fn());
			flushSync();
			unmount(instance);
			// The cleanup refocuses the opener — the observable return behavior.
			expect(openerFocus).toHaveBeenCalled();
		} finally {
			delete (document as unknown as { activeElement?: unknown }).activeElement;
			opener.remove();
		}
	});
});

describe('PanelLoupe — the lens flag reaches the snippet (D8)', () => {
	it('a component inside the children snippet reads lens=true through the portal', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(LensLoupeProbeBody, { target, props: { onclose: vi.fn() } });
		flushSync();
		const probe = root().querySelector('[data-testid="lens-probe"]') as HTMLElement;
		expect(probe).not.toBeNull(); // rendered inside the portaled dialog
		expect(probe.getAttribute('data-lens')).toBe('true');
		unmount(instance);
	});

	it('the composer body: sync check visible-disabled, header verbs disabled, the lens × enabled', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(LensLoupeComposerBody, { target, props: { onclose: vi.fn() } });
		flushSync();
		const check = inRoot('prompt-sync-check') as HTMLButtonElement;
		expect(check).not.toBeNull(); // visible — the verb renders whole
		expect(check.disabled).toBe(true);
		expect(inRoot('panel-move-left')).not.toBeNull();
		expect(inRoot('panel-move-right')).not.toBeNull();
		const close = inRoot('panel-close') as HTMLButtonElement;
		expect(close).not.toBeNull();
		expect(close.disabled).toBe(true); // no onremove pass-through — inert by mount
		expect((inRoot('panel-header-copy-id') as HTMLButtonElement).disabled).toBe(false);
		const lensClose = inRoot('panel-loupe-close') as HTMLButtonElement;
		expect(lensClose.disabled).toBe(false); // the loupe's own close stays live
		unmount(instance);
	});

	it('the × anchors to the SHEET (not the viewport) and the body row is the panel\'s flex parent', () => {
		// Geometry cannot be measured in happy-dom (zero rects) — the
		// structure + source contract carry the pin; the measured contract
		// lives in panel-floor e2e spec 28.
		const { target, instance } = mountLoupe(vi.fn());
		const sheet = root().querySelector('[data-testid="panel-loupe-sheet"]') as HTMLElement;
		const lensClose = inRoot('panel-loupe-close') as HTMLElement;
		expect(sheet.contains(lensClose)).toBe(true); // the × hugs the content
		expect(lensClose.className).toContain('absolute');
		expect(lensClose.className).not.toContain('fixed');
		unmount(instance);

		// Source contract (the floating-anchor.test.ts idiom): the body row
		// must be a FLEX COLUMN — ConversationPanel's root is flex-1 +
		// overflow-auto and bounds its scroll area against a flex parent
		// exactly as the floor's .body does; a block parent clips the
		// transcript instead of scrolling it. The × must never be
		// viewport-fixed again.
		const src = readFileSync(
			join(process.cwd(), 'src/lib/components/panels/PanelLoupe.svelte'),
			'utf8'
		);
		expect(src).toContain('"flex min-h-0 flex-1 flex-col overflow-hidden"');
		expect(src).not.toMatch(/class="fixed top-5 right-5/);
		// The sheet width is VIEWPORT-relative, never track-relative (the
		// grey-mask bug, 2026-09-08): a % width resolves against the auto
		// grid track, whose max-content a wide body (markdown, Monaco,
		// manager table) inflates off-screen — the sheet must not depend
		// on the track it sits in.
		expect(src).toContain('width: min(100vw - 4rem, 850px)');
		expect(src).not.toContain('100% - 4rem');
	});
});
