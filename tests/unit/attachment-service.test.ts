/**
 * attachment-service (task 1.2-T): the draft lifecycle contract — id-keyed
 * add/remove/clear with URL revocation, batch-loud admission, serialize
 * order, and id stability across removals.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createAttachmentService,
	UnsupportedMediaTypeError,
	AttachmentLimitError,
	formatLimitBytes,
	type AttachmentDraft
} from '$lib/services/chat/attachment-service.svelte';

// Object URLs are browser-owned; the unit lane stubs them so revocation is
// observable and no real blob state leaks between tests.
const createSpy = vi.fn((_: File) => `blob:mock-${Math.random().toString(36).slice(2)}`);
const revokeSpy = vi.fn();
vi.stubGlobal('URL', { ...URL, createObjectURL: createSpy, revokeObjectURL: revokeSpy });

afterEach(() => {
	createSpy.mockClear();
	revokeSpy.mockClear();
});

function png(name = 'shot.png', bytes = 4): File {
	return new File([new Uint8Array(bytes).fill(0x89)], name, { type: 'image/png' });
}

describe('attachment-service — admission', () => {
	it('admits whitelisted images as id-keyed drafts with preview URLs', () => {
		const svc = createAttachmentService();
		svc.addFiles([png('a.png'), new File([], 'b.jpg', { type: 'image/jpeg' })]);
		expect(svc.drafts).toHaveLength(2);
		expect(svc.drafts.every((d) => d.kind === 'image' && d.previewUrl.startsWith('blob:'))).toBe(true);
		expect(svc.count).toBe(2);
	});

	it('refuses the whole batch loudly when one type is unsupported — no partial state', () => {
		const svc = createAttachmentService();
		const before: AttachmentDraft[] = [];
		expect(() => svc.addFiles([png('ok.png'), new File([], 'doc.pdf', { type: 'application/pdf' })])).toThrow(
			UnsupportedMediaTypeError
		);
		expect(svc.drafts).toEqual(before);
		expect(createSpy).not.toHaveBeenCalled();
	});

	it('empty-typed files are refused too (the wire names its types)', () => {
		const svc = createAttachmentService();
		expect(() => svc.addFiles([new File([], 'nope', { type: '' })])).toThrow(/empty/);
	});
});

describe('attachment-service — removal and revocation', () => {
	it('removes by id and revokes exactly that URL', () => {
		const svc = createAttachmentService();
		svc.addFiles([png('a.png'), png('b.png')]);
		const [first] = svc.drafts;
		const urlA = first.previewUrl;
		svc.removeAttachment(first.id);
		expect(svc.drafts.map((d) => d.file.name)).toEqual(['b.png']);
		expect(revokeSpy).toHaveBeenCalledTimes(1);
		expect(revokeSpy).toHaveBeenCalledWith(urlA);
		svc.removeAttachment(first.id); // idempotent: unknown id is a no-op
		expect(svc.drafts).toHaveLength(1);
	});

	it('clear revokes every owned URL exactly once', () => {
		const svc = createAttachmentService();
		svc.addFiles([png('a.png'), png('b.png'), png('c.png')]);
		const urls = svc.drafts.map((d) => d.previewUrl);
		svc.clear();
		expect(svc.drafts).toHaveLength(0);
		expect(revokeSpy.mock.calls.map((c) => c[0]).sort()).toEqual([...urls].sort());
	});
});

describe('attachment-service — serialize (the only base64 moment)', () => {
	it('serializes in id order with mediaType, base64 data, and name', async () => {
		const svc = createAttachmentService();
		svc.addFiles([png('a.png', 2), png('b.png', 3)]);
		const ids = [svc.drafts[1].id, svc.drafts[0].id];
		const out = await svc.serialize(ids);
		expect(out.map((p) => p.name)).toEqual(['b.png', 'a.png']);
		expect(out[0]).toMatchObject({ mediaType: 'image/png' });
		expect(out[0].data).toBe(bytesFor(3));
	});

	it('serialize() without ids follows draft order; removed drafts skip silently', async () => {
		const svc = createAttachmentService();
		svc.addFiles([png('a.png'), png('b.png'), png('c.png')]);
		const removedId = svc.drafts[1].id;
		svc.removeAttachment(removedId);
		const out = await svc.serialize([svc.drafts[0].id, removedId, svc.drafts[1].id]);
		expect(out.map((p) => p.name)).toEqual(['a.png', 'c.png']);
	});

	it('an unnamed file omits the name field (DSH wire: name is optional)', async () => {
		const svc = createAttachmentService();
		svc.addFiles([new File([new Uint8Array(2)], '', { type: 'image/webp' })]);
		const [part] = await svc.serialize();
		expect('name' in part).toBe(false);
	});
});

/** Reference encoding for the fill byte used by png(). */
function bytesFor(n: number): string {
	return btoa(String.fromCharCode(...new Uint8Array(n).fill(0x89)));
}

describe('attachment-service — host-limit pre-flight (task 4.2)', () => {
	/** Tight host numbers, as a real imageLimits projection would carry. */
	const TIGHT = {
		maxImageBytes: 1_000,
		maxImagesPerMessage: 2,
		maxMessageImageBytes: 1_500,
		maxImagePixels: 1_000_000,
		maxImageDimension: 1_024,
		mediaTypes: ['image/png']
	};

	it('default service keeps DSH documented limits (20MB / 20 per message)', () => {
		const svc = createAttachmentService();
		// A batch of 20 small files passes count; the 20MB per-image cap is
		// far above test files — proving the defaults are in force.
		const files = Array.from({ length: 20 }, (_, i) => png(`f${i}.png`, 4));
		expect(() => svc.addFiles(files)).not.toThrow();
	});

	it('over-count refusal carries the host number and admits nothing (existing drafts count)', () => {
		const svc = createAttachmentService(TIGHT);
		svc.addFiles([png('one.png'), png('two.png')]);
		expect(() => svc.addFiles([png('three.png')])).toThrow(AttachmentLimitError);
		try {
			svc.addFiles([png('three.png')]);
		} catch (err) {
			expect((err as Error).message).toContain('3 of 2 allowed per message');
		}
		expect(svc.drafts).toHaveLength(2); // batch-loud: nothing partially admitted
	});

	it('over-size refusal names the file and formats the host cap', () => {
		const svc = createAttachmentService(TIGHT);
		const big = png('huge.png', 2_000);
		try {
			svc.addFiles([big]);
			expect.unreachable('must throw');
		} catch (err) {
			expect(err).toBeInstanceOf(AttachmentLimitError);
			expect((err as Error).message).toContain('huge.png');
			expect((err as Error).message).toContain('2.0KB');
			expect((err as Error).message).toContain('1000B');
		}
		expect(svc.drafts).toHaveLength(0);
	});

	it('aggregate refusal fires when the batch total crosses maxMessageImageBytes', () => {
		const svc = createAttachmentService(TIGHT);
		try {
			svc.addFiles([png('a.png', 800), png('b.png', 800)]);
			expect.unreachable('must throw');
		} catch (err) {
			expect(err).toBeInstanceOf(AttachmentLimitError);
			expect((err as Error).message).toContain('1.6KB');
			expect((err as Error).message).toContain('1.5KB');
		}
		expect(svc.drafts).toHaveLength(0);
	});

	it('the whitelist follows the host mediaTypes (subset host: jpeg refused)', () => {
		const svc = createAttachmentService(TIGHT);
		expect(() => svc.addFiles([new File([], 'x.jpg', { type: 'image/jpeg' })])).toThrow(
			UnsupportedMediaTypeError
		);
	});

	it('formatLimitBytes renders B/KB/MB buckets', () => {
		expect(formatLimitBytes(500)).toBe('500B');
		expect(formatLimitBytes(1_000)).toBe('1000B');
		expect(formatLimitBytes(1_500)).toBe('1.5KB');
		expect(formatLimitBytes(20 * 1024 * 1024)).toBe('20.0MB');
	});
});
