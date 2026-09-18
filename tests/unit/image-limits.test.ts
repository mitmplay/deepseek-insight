/**
 * image-limits (task 4.1-T): the projections fold — present carries the
 * host's numbers verbatim; absent/malformed/partial fall back (the caller's
 * job; the reader just says null). Pinned to imageLimitsProjectionSchema.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_LIMITS, imageLimitsFromProjection } from '$lib/services/conversation/image-limits';

const HOST_LIMITS = {
	maxImageBytes: 1024,
	maxImagesPerMessage: 2,
	maxMessageImageBytes: 2048,
	maxImagePixels: 1_000_000,
	maxImageDimension: 1024,
	mediaTypes: ['image/png']
};

describe('imageLimitsFromProjection', () => {
	it('a present, well-formed value returns the host numbers verbatim (copy, not reference)', () => {
		const raw = { ...HOST_LIMITS, mediaTypes: ['image/png', 'image/webp'] };
		const limits = imageLimitsFromProjection(raw);
		expect(limits).toEqual({ ...HOST_LIMITS, mediaTypes: ['image/png', 'image/webp'] });
		expect(limits!.mediaTypes).not.toBe(raw.mediaTypes); // defensive copy
	});

	it('absent (undefined/null) → null — the caller falls back to defaults', () => {
		expect(imageLimitsFromProjection(undefined)).toBeNull();
		expect(imageLimitsFromProjection(null)).toBeNull();
		expect(DEFAULT_IMAGE_LIMITS.maxImagesPerMessage).toBe(20); // DSH documented default
	});

	it('malformed shapes → null (all-or-nothing: never partially trusted)', () => {
		expect(imageLimitsFromProjection('imageLimits')).toBeNull();
		expect(imageLimitsFromProjection(42)).toBeNull();
		expect(imageLimitsFromProjection([])).toBeNull();
		expect(imageLimitsFromProjection({ ...HOST_LIMITS, maxImageBytes: 'big' })).toBeNull();
		expect(imageLimitsFromProjection({ ...HOST_LIMITS, maxImagesPerMessage: 0 })).toBeNull();
		expect(imageLimitsFromProjection({ ...HOST_LIMITS, maxImageBytes: 1.5 })).toBeNull(); // non-integer
	});

	it('partial or empty media lists → null', () => {
		expect(imageLimitsFromProjection({ ...HOST_LIMITS, mediaTypes: [] })).toBeNull();
		expect(imageLimitsFromProjection({ ...HOST_LIMITS, mediaTypes: ['image/png', 7] })).toBeNull();
		const missing = { ...HOST_LIMITS } as Record<string, unknown>;
		delete missing.maxMessageImageBytes;
		expect(imageLimitsFromProjection(missing)).toBeNull();
	});
});
