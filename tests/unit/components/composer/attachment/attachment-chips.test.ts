/**
 * AttachmentChips (task 1.4-T): pure render contract — one chip per draft,
 * remove carries the draft id, empty state renders nothing.
 */
import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import AttachmentChips from '$lib/components/composer/attachment/AttachmentChips.svelte';
import type { AttachmentDraft } from '$lib/services/chat/attachment-service.svelte';

function draft(id: string, name: string, size = 2048): AttachmentDraft {
	return {
		kind: 'image',
		id,
		file: new File([new Uint8Array(size)], name, { type: 'image/png' }),
		mediaType: 'image/png',
		previewUrl: `blob:mock-${id}`
	};
}

function mountChips(drafts: AttachmentDraft[]) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onremove = vi.fn();
	const comp = mount(AttachmentChips, { target, props: { drafts, onremove } });
	flushSync();
	return {
		target,
		onremove,
		cleanup: () => {
			unmount(comp);
			target.remove();
		}
	};
}

describe('AttachmentChips', () => {
	it('renders nothing with no drafts', () => {
		const h = mountChips([]);
		expect(h.target.querySelector('[data-testid="attachment-chips"]')).toBeNull();
		h.cleanup();
	});

	it('renders one image card per draft — thumbnail only, no name/size labels', () => {
		const h = mountChips([draft('a', 'shot.png'), draft('b', 'wide.png', 3 * 1024 * 1024)]);
		const chips = h.target.querySelectorAll('[data-testid="attachment-chip"]');
		expect(chips).toHaveLength(2);
		// The file name survives only as the img alt (DSH rail shape).
		const thumb = h.target.querySelector('[data-testid="attachment-chip-thumb"]') as HTMLImageElement;
		expect(thumb.getAttribute('src')).toBe('blob:mock-a');
		expect(thumb.getAttribute('alt')).toBe('shot.png');
		expect(h.target.querySelector('[data-testid="attachment-chip-name"]')).toBeNull();
		expect(chips[1].textContent).not.toContain('MB');
		h.cleanup();
	});

	it('remove click carries exactly that draft id — never an index', async () => {
		const h = mountChips([draft('a', 'a.png'), draft('b', 'b.png')]);
		const removes = h.target.querySelectorAll('[data-testid="attachment-chip-remove"]');
		(removes[1] as HTMLButtonElement).click();
		await Promise.resolve();
		flushSync();
		expect(h.onremove).toHaveBeenCalledTimes(1);
		expect(h.onremove).toHaveBeenCalledWith('b');
		h.cleanup();
	});
});

// ── Coverage extension (2026-08-26): default props, formatSize branches,
//    and the empty-name fallbacks on thumb alt / label / remove aria. ────

describe('AttachmentChips — defaults and fallback text', () => {
	it('mounts with no props at all — the default drafts render nothing', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AttachmentChips, { target });
		flushSync();
		expect(target.querySelector('[data-testid="attachment-chips"]')).toBeNull();
		unmount(comp);
		target.remove();
	});

	it('the default onremove is a safe no-op when the parent passes none', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AttachmentChips, { target, props: { drafts: [draft('orphan', 'x.png')] } });
		flushSync();
		(target.querySelector('[data-testid="attachment-chip-remove"]') as HTMLButtonElement).click();
		await Promise.resolve();
		flushSync();
		expect(target.querySelectorAll('[data-testid="attachment-chip"]').length).toBe(1); // unchanged
		unmount(comp);
		target.remove();
	});

	it('the thumbnail button invites the original preview with a Show original tooltip', () => {
		const h = mountChips([draft('t', 'shot.png')]);
		const open = h.target.querySelector('[data-testid="attachment-chip-open"]') as HTMLButtonElement;
		expect(open.getAttribute('title')).toBe('Show original');
		h.cleanup();
	});

	it('an empty file name falls back on every surface: alt, lightbox alt, remove aria', async () => {
		const h = mountChips([draft('anon', '')]);
		const chip = h.target.querySelector('[data-testid="attachment-chip"]') as HTMLElement;
		// Thumb alt + the remove button's aria both say "image" — no label
		// renders anymore, the alt IS the name surface (DSH rail shape).
		const thumb = h.target.querySelector('[data-testid="attachment-chip-thumb"]') as HTMLImageElement;
		expect(thumb.getAttribute('alt')).toBe('image draft');
		const remove = h.target.querySelector('[data-testid="attachment-chip-remove"]') as HTMLButtonElement;
		expect(remove.getAttribute('aria-label')).toBe('Remove attachment image');
		// The id (never the missing name) rides the remove callback.
		remove.click();
		await Promise.resolve();
		flushSync();
		expect(h.onremove).toHaveBeenCalledTimes(1);
		expect(h.onremove).toHaveBeenCalledWith('anon');
		expect(chip).not.toBeNull();
		h.cleanup();
	});
});

// ── Lightbox (2026-08-28, DSH ImageLightbox parity): thumbnail click opens
//    the ORIGINAL image at document level; mask press and Escape close. ────

describe('AttachmentChips — lightbox', () => {
	function openLightbox() {
		const h = mountChips([draft('big', 'shot.png')]);
		const open = h.target.querySelector('[data-testid="attachment-chip-open"]') as HTMLButtonElement;
		open.click();
		flushSync();
		return h;
	}

	function lightbox(): HTMLElement | null {
		return document.querySelector('[data-testid="attachment-lightbox"]');
	}

	it('clicking the thumbnail opens the lightbox at document level with the original image', () => {
		const h = openLightbox();
		const box = lightbox();
		expect(box).not.toBeNull();
		// Portaled OUT of the component's target (the floor zoom would trap it).
		expect(h.target.contains(box!)).toBe(false);
		const img = box!.querySelector('[data-testid="attachment-lightbox-image"]') as HTMLImageElement;
		expect(img.getAttribute('src')).toBe('blob:mock-big');
		expect(img.getAttribute('alt')).toBe('shot.png');
		h.cleanup();
	});

	it('a press on the mask — outside the image — closes the lightbox', () => {
		const h = openLightbox();
		const mask = document.querySelector('[data-testid="attachment-lightbox-mask"]') as HTMLElement;
		mask.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		flushSync();
		expect(lightbox()).toBeNull();
		h.cleanup();
	});

	it('Escape closes the lightbox', () => {
		const h = openLightbox();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(lightbox()).toBeNull();
		h.cleanup();
	});

	it('the lightbox unmounts cleanly with the component (portal destroy leaves nothing behind)', () => {
		const h = openLightbox();
		h.cleanup();
		expect(lightbox()).toBeNull();
	});
});
