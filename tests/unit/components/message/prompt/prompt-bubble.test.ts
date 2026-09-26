/**
 * PromptBubble component contract (2026-09-05): the two skins (prompt vs
 * context tone), the attachment gallery gate (imageRefs AND sessionId), and
 * the children slot — the surfaces the table regression
 * (prompt-bubble-table.test.ts) never mounts.
 */
import { createRawSnippet, mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PromptBubble from '$lib/components/message/prompt/PromptBubble.svelte';
import type { DsiImageRef } from '$lib/types';
import { invalidateSessionAttachmentUrls } from '$lib/services/conversation/attachment-urls.svelte';

// MessageImages fetches its blobs through URL.createObjectURL + fetch —
// stub both the way message-images.test.ts does.
vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock-pb'), revokeObjectURL: vi.fn() });
const okBody = { ok: true, attachment: { mediaType: 'image/png' }, data: btoa('png') };
const fetchSpy = vi.fn(async () =>
	new Response(JSON.stringify(okBody), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	})
);
vi.stubGlobal('fetch', fetchSpy);

const ref = (id: string): DsiImageRef => ({
	attachmentId: id,
	mediaType: 'image/png',
	bytes: 3,
	width: 1,
	height: 1
});

/** A real snippet rendering one marker element — createRawSnippet is the
 *  supported test-side way to hand a component a children block. */
function markerSnippet(testid: string): import('svelte').Snippet {
	return createRawSnippet(() => ({
		render: () => `<span data-testid="${testid}">marker</span>`
	})) as unknown as import('svelte').Snippet;
}

type Props = {
	text?: string;
	time?: number;
	tone?: 'prompt' | 'context';
	imageRefs?: DsiImageRef[];
	sessionId?: string;
	children?: import('svelte').Snippet;
};

function mountBubble(props: Props) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(PromptBubble, { target, props });
	flushSync();
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

async function settle(ms = 20): Promise<void> {
	for (let i = 0; i < 4; i++) { flushSync(); await Promise.resolve(); }
	await new Promise((r) => setTimeout(r, ms));
	flushSync();
}

afterEach(() => {
	invalidateSessionAttachmentUrls('s-pb');
	fetchSpy.mockClear();
});

describe('PromptBubble — skins, gallery gate, children slot', () => {
	it('default tone is the human prompt skin (bg-accent-blue/15)', () => {
		const h = mountBubble({ text: 'hello', time: 1 });
		const bubble = h.target.querySelector('[data-testid="message-bubble"]') as HTMLElement;
		expect(bubble.className).toContain('bg-accent-blue/15');
		h.cleanup();
	});

	it("tone='context' wears the quieter harness skin (bg-accent-blue/10)", () => {
		const h = mountBubble({ text: 'injected', time: 1, tone: 'context' });
		const bubble = h.target.querySelector('[data-testid="message-bubble"]') as HTMLElement;
		expect(bubble.className).toContain('bg-accent-blue/10');
		expect(bubble.className).not.toContain('bg-accent-blue/15');
		h.cleanup();
	});

	it('imageRefs + sessionId render the gallery ON TOP of the bubble, as a sibling', async () => {
		const h = mountBubble({ text: 'with pic', time: 1, imageRefs: [ref('sha256:pb1')], sessionId: 's-pb' });
		await settle();
		const gallery = h.target.querySelector('[data-testid="message-images"]');
		expect(gallery).not.toBeNull();
		const bubble = h.target.querySelector('[data-testid="message-bubble"]') as HTMLElement;
		// Sibling order: the gallery div precedes the bubble (gallery on top)
		expect(
			(gallery as Node).compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		h.cleanup();
	});

	it('imageRefs WITHOUT sessionId render no gallery — no unauthorized read', () => {
		const h = mountBubble({ text: 'orphan', time: 1, imageRefs: [ref('sha256:pb2')] });
		expect(h.target.querySelector('[data-testid="message-images"]')).toBeNull();
		h.cleanup();
	});

	it('children render inside the bubble beneath the body', () => {
		const h = mountBubble({ text: 'body', time: 1, children: markerSnippet('pb-child') });
		const bubble = h.target.querySelector('[data-testid="message-bubble"]') as HTMLElement;
		expect(bubble.querySelector('[data-testid="pb-child"]')).not.toBeNull();
		h.cleanup();
	});

	it('children-only mount (context chips) renders no markdown body', () => {
		const h = mountBubble({ children: markerSnippet('pb-chip') });
		expect(h.target.querySelector('.md-content')).toBeNull();
		expect(h.target.querySelector('[data-testid="pb-chip"]')).not.toBeNull();
		h.cleanup();
	});
});
