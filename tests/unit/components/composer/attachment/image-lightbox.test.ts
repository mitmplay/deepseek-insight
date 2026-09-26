/**
 * ImageLightbox unit tests — the portaled original-image preview:
 * closes on Escape, the close control, or a mask press; a non-Escape
 * key is ignored; focus moves to the close control on open (even when
 * nothing was focused before — activeElement may be null) and returns
 * to the opener on unmount.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImageLightbox from '$lib/components/composer/attachment/ImageLightbox.svelte';

function mountLightbox(onclose: () => void) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ImageLightbox, {
		target,
		props: { src: '/img/original.png', alt: 'screenshot', onclose }
	});
	flushSync();
	return { target, instance };
}

function root(): HTMLElement {
	return document.querySelector('[data-testid="attachment-lightbox"]')!;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ImageLightbox — dismissal', () => {
	it('Escape closes; a non-Escape key does nothing', () => {
		const onclose = vi.fn();
		const { instance } = mountLightbox(onclose);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
		flushSync();
		expect(onclose).not.toHaveBeenCalled();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(onclose).toHaveBeenCalledOnce();
		unmount(instance);
	});

	it('the close control closes', () => {
		const onclose = vi.fn();
		const { instance } = mountLightbox(onclose);
		(document.querySelector('[data-testid="attachment-lightbox-close"]') as HTMLElement).click();
		expect(onclose).toHaveBeenCalledOnce();
		unmount(instance);
	});

	it('a press on the mask (outside the image) closes', () => {
		const onclose = vi.fn();
		const { instance } = mountLightbox(onclose);
		(document.querySelector('[data-testid="attachment-lightbox-mask"]') as HTMLElement).dispatchEvent(
			// bubbles: true — Svelte's delegated listeners live at the document root.
			new MouseEvent('mousedown', { bubbles: true })
		);
		expect(onclose).toHaveBeenCalledOnce();
		unmount(instance);
	});
});

describe('ImageLightbox — portal + focus', () => {
	it('portals the dialog to document.body and removes it on unmount', () => {
		const { instance } = mountLightbox(vi.fn());
		expect(root()).not.toBeNull();
		expect(root().getAttribute('role')).toBe('dialog');
		unmount(instance);
		expect(document.querySelector('[data-testid="attachment-lightbox"]')).toBeNull();
	});

	it('focus moves to the close control on open (happy-dom cannot focus buttons — spy the call)', () => {
		const focusSpy = vi.spyOn(HTMLButtonElement.prototype, 'focus').mockImplementation(() => {});
		try {
			const { instance } = mountLightbox(vi.fn());
			flushSync();
			expect(focusSpy).toHaveBeenCalled();
			unmount(instance);
		} finally {
			focusSpy.mockRestore();
		}
	});

	it('an opener-less mount (activeElement null) still resolves its focus target', () => {
		const original = document.activeElement;
		Object.defineProperty(document, 'activeElement', { configurable: true, get: () => null });
		try {
			const { instance } = mountLightbox(vi.fn());
			flushSync();
			// The opener snapshot degraded to null — the lightbox still opened.
			expect(document.querySelector('[data-testid="attachment-lightbox"]')).not.toBeNull();
			unmount(instance);
			expect(document.querySelector('[data-testid="attachment-lightbox"]')).toBeNull();
		} finally {
			Object.defineProperty(document, 'activeElement', {
				configurable: true,
				get: () => original
			});
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
			const { instance } = mountLightbox(vi.fn());
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
