/**
 * Composer attachments wiring (task 1.5-T): the widened submit
 * signature (text, images: SerializedImage[]) — serialized at submit (W2),
 * forwarding into drafts, and clear-after-completed-submit.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Composer from '$lib/components/composer/Composer.svelte';
import type { AttachmentDraft } from '$lib/services/chat/attachment-service.svelte';

const createSpy = vi.fn((_: File) => `blob:mock-${Math.random().toString(36).slice(2)}`);
const revokeSpy = vi.fn();
vi.stubGlobal('URL', { ...URL, createObjectURL: createSpy, revokeObjectURL: revokeSpy });
// app-config singleton fetch: never-resolving keeps the documented defaults
vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

afterEach(() => {
	createSpy.mockClear();
	revokeSpy.mockClear();
});

function mountInput(onsubmit: (text: string, images: unknown[]) => boolean | Promise<boolean>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(Composer, {
		target,
		props: { onsubmit, oncancel: () => {}, isStreaming: false, sending: false }
	});
	flushSync();
	const textarea = () => target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
	const send = () => target.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
	const chips = () => target.querySelectorAll('[data-testid="attachment-chip"]');
	return {
		target,
		textarea,
		send,
		chips,
		cleanup: () => {
			unmount(comp);
			target.remove();
		}
	};
}

async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
	// serialize() awaits File.arrayBuffer(), which happy-dom resolves on a
	// macrotask — one timer hop lets the submit chain reach the callback.
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

function typeText(h: ReturnType<typeof mountInput>, text: string): void {
	const ta = h.textarea();
	ta.value = text;
	ta.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function pasteImage(h: ReturnType<typeof mountInput>, name = 'pasted.png'): void {
	const ev = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(ev, 'clipboardData', {
		value: {
			items: [{ type: 'image/png', getAsFile: () => new File([new Uint8Array(4)], name, { type: 'image/png' }) }]
		}
	});
	h.textarea().dispatchEvent(ev);
}

describe('Composer — attachments wiring', () => {
	it('empty text and no drafts keeps Send disabled; text alone enables (regression)', async () => {
		const h = mountInput(vi.fn());
		expect(h.send().disabled).toBe(true);
		typeText(h, 'hello');
		await settle();
		expect(h.send().disabled).toBe(false);
		h.cleanup();
	});

	it('a pasted draft enables Send with empty text; removing it disables again', async () => {
		const h = mountInput(vi.fn());
		pasteImage(h);
		await settle();
		expect(h.chips()).toHaveLength(1);
		expect(h.send().disabled).toBe(false);
		(h.target.querySelector('[data-testid="attachment-chip-remove"]') as HTMLButtonElement).click();
		await settle();
		expect(h.chips()).toHaveLength(0);
		expect(h.send().disabled).toBe(true);
		h.cleanup();
	});

	it('submit passes (text, serialized images) and clears drafts once it resolves', async () => {
		const onsubmit = vi.fn(async (_text: string, _images: unknown[]) => true);
		const h = mountInput(onsubmit);
		pasteImage(h, 'with-text.png');
		await settle();
		typeText(h, 'look at this');
		h.send().click();
		await settle();
		expect(onsubmit).toHaveBeenCalledTimes(1);
		const [text, images] = onsubmit.mock.calls[0] as [string, Array<Record<string, unknown>>];
		expect(text).toBe('look at this');
		expect(images).toHaveLength(1);
		expect(images[0]).toMatchObject({ mediaType: 'image/png', name: 'with-text.png' });
		expect(typeof images[0].data).toBe('string');
		expect(h.chips()).toHaveLength(0);
		expect(revokeSpy).toHaveBeenCalled();
		h.cleanup();
	});

	it('image-only submit sends empty text with its serialized image (W2 wire)', async () => {
		const onsubmit = vi.fn(async (_text: string, _images: unknown[]) => true);
		const h = mountInput(onsubmit);
		pasteImage(h, 'only.png');
		await settle();
		h.send().click();
		await settle();
		expect(onsubmit).toHaveBeenCalledWith('', [expect.objectContaining({ mediaType: 'image/png' })]);
		h.cleanup();
	});

	it('onsubmit resolving false keeps the drafts (BC-A3 admission contract)', async () => {
		const onsubmit = vi.fn(async (_text: string, _images: unknown[]) => false);
		const h = mountInput(onsubmit);
		pasteImage(h, 'kept.png');
		await settle();
		h.send().click();
		await settle();
		expect(onsubmit).toHaveBeenCalled();
		expect(h.chips()).toHaveLength(1);
		h.cleanup();
	});
});
