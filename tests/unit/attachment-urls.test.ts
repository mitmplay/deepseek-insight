/**
 * attachment-urls (task 3.3-T): the per-session URL cache contract —
 * fetch-once dedupe (including in-flight), generation invalidation with
 * revocation, and the stale-generation guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createSpy = vi.fn((blob: Blob) => 'blob:mock-' + Math.random().toString(36).slice(2));
const revokeSpy = vi.fn();
vi.stubGlobal('URL', { ...URL, createObjectURL: createSpy, revokeObjectURL: revokeSpy });

// Deterministic fetch script per test.
let script: (url: string) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }> =
	() => ({ status: 200, body: { ok: true } });
const fetchSpy = vi.fn(async (url: unknown) => {
	const r = await script(String(url));
	return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
});
vi.stubGlobal('fetch', fetchSpy);

const okBody = { ok: true, attachment: { mediaType: 'image/png' }, data: btoa('pngbytes') };

import {
	invalidateSessionAttachmentUrls,
	resolveAttachmentUrl
} from '$lib/services/conversation/attachment-urls.svelte';

beforeEach(() => {
	script = () => ({ status: 200, body: okBody });
	fetchSpy.mockClear();
	createSpy.mockClear();
	revokeSpy.mockClear();
});

afterEach(() => {
	// Hard reset: the module is a singleton; tests invalidate both sessions.
	invalidateSessionAttachmentUrls('s1');
	invalidateSessionAttachmentUrls('s2');
});

describe('resolveAttachmentUrl', () => {
	it('fetches once and caches per (session, attachment); a second resolve is a cache hit', async () => {
		const url1 = await resolveAttachmentUrl('s1', 'sha256:a');
		const url2 = await resolveAttachmentUrl('s1', 'sha256:a');
		expect(url1).toBe(url2);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(createSpy).toHaveBeenCalledTimes(1);
		// another session's bucket is a separate fetch (authorization scope)
		await resolveAttachmentUrl('s2', 'sha256:a');
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('concurrent resolves share ONE in-flight fetch (dedupe)', async () => {
		const [a, b, c] = await Promise.all([
			resolveAttachmentUrl('s1', 'sha256:cc'),
			resolveAttachmentUrl('s1', 'sha256:cc'),
			resolveAttachmentUrl('s1', 'sha256:cc')
		]);
		expect(new Set([a, b, c]).size).toBe(1);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('a failed read rejects with the server message and stays uncached', async () => {
		script = () => ({ status: 502, body: { ok: false, error: { message: 'no such attachment' } } });
		await expect(resolveAttachmentUrl('s1', 'sha256:gone')).rejects.toThrow('no such attachment');
		// not cached — a retry (now succeeding) fetches again
		script = () => ({ status: 200, body: okBody });
		await expect(resolveAttachmentUrl('s1', 'sha256:gone')).resolves.toBeTruthy();
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});
});

describe('invalidateSessionAttachmentUrls', () => {
	it('revokes every owned URL of that session, keeps other sessions intact, and re-resolve refetches', async () => {
		const u1 = await resolveAttachmentUrl('s1', 'sha256:a');
		const u2 = await resolveAttachmentUrl('s1', 'sha256:b');
		const uOther = await resolveAttachmentUrl('s2', 'sha256:a');
		invalidateSessionAttachmentUrls('s1');
		const revoked = revokeSpy.mock.calls.map((c) => c[0]);
		expect(revoked).toContain(u1);
		expect(revoked).toContain(u2);
		expect(revoked).not.toContain(uOther);
		// s2's URL is still live in cache — no refetch
		await resolveAttachmentUrl('s2', 'sha256:a');
		expect(fetchSpy).toHaveBeenCalledTimes(3);
		// s1's were dropped — refetch mints a NEW url
		const u1again = await resolveAttachmentUrl('s1', 'sha256:a');
		expect(u1again).not.toBe(u1);
	});

	it('stale generation never publishes: an in-flight load resolving after invalidate rejects and revokes its URL', async () => {
		let release: (v: void) => void = () => {};
		const gate = new Promise<void>((r) => (release = r));
		script = async () => {
			await gate;
			return { status: 200, body: okBody };
		};
		const pending = resolveAttachmentUrl('s1', 'sha256:slow');
		// Invalidate BEFORE the fetch answers.
		invalidateSessionAttachmentUrls('s1');
		release();
		await expect(pending).rejects.toThrow('scope was released');
		// The URL minted by the dead load was revoked immediately.
		expect(revokeSpy).toHaveBeenCalled();
		// And the entry never landed in the cache.
		script = () => ({ status: 200, body: okBody });
		await resolveAttachmentUrl('s1', 'sha256:slow');
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});
});
