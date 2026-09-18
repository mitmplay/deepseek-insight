/**
 * image-limits (task 4.1) — the host's attachment admission numbers, read
 * from the history-tail projections block (the permission-state seam:
 * same block, same cold-load + runtime-cold paths, pure mapping — no I/O,
 * no Svelte). The host is authoritative for what it will admit
 * (attachment-local config projected as imageLimits); DSI pre-flights
 * drafts against THESE numbers instead of hardcoding (BC-A6).
 *
 * Fallbacks are the DSH documented defaults (attachment-local
 * DEFAULT_MAX_* constants) — used when the projection is absent (older
 * host) or malformed (all-or-nothing: a malformed projection is a broken
 * contract, never a partially trusted one).
 */

/** The wire projection's six fields (imageLimitsProjectionSchema). */
export interface DsiImageLimits {
	/** Per-image byte cap (host admission: image-too-large above this). */
	maxImageBytes: number;
	/** Images allowed in one message. */
	maxImagesPerMessage: number;
	/** Aggregate byte cap across one message's images. */
	maxMessageImageBytes: number;
	/** Normalization budget (pixels) — host-side; informational for the UI. */
	maxImagePixels: number;
	/** Normalization budget (per dimension) — host-side; informational. */
	maxImageDimension: number;
	/** Accepted raster media types, in host order. */
	mediaTypes: string[];
}

/** DSH documented defaults (fallback when no projection rides the tail). */
export const DEFAULT_IMAGE_LIMITS: DsiImageLimits = {
	maxImageBytes: 20 * 1024 * 1024,
	maxImagesPerMessage: 20,
	maxMessageImageBytes: 200 * 1024 * 1024,
	maxImagePixels: 64_000_000,
	maxImageDimension: 8192,
	mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
};

function isPositiveInt(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Validate the projections block's imageLimits value.
 *
 * @param raw - the projection value (projections.values.imageLimits), untyped.
 * @returns the six-field limits, or null when absent/malformed — the caller
 * then falls back to DEFAULT_IMAGE_LIMITS (BC-A6).
 */
export function imageLimitsFromProjection(raw: unknown): DsiImageLimits | null {
	if (!raw || typeof raw !== 'object') return null;
	const value = raw as Record<string, unknown>;
	if (
		!isPositiveInt(value.maxImageBytes) ||
		!isPositiveInt(value.maxImagesPerMessage) ||
		!isPositiveInt(value.maxMessageImageBytes) ||
		!isPositiveInt(value.maxImagePixels) ||
		!isPositiveInt(value.maxImageDimension) ||
		!Array.isArray(value.mediaTypes) ||
		value.mediaTypes.length === 0 ||
		!value.mediaTypes.every((t): t is string => typeof t === 'string' && t.length > 0)
	) {
		return null;
	}
	return {
		maxImageBytes: value.maxImageBytes,
		maxImagesPerMessage: value.maxImagesPerMessage,
		maxMessageImageBytes: value.maxMessageImageBytes,
		maxImagePixels: value.maxImagePixels,
		maxImageDimension: value.maxImageDimension,
		mediaTypes: [...(value.mediaTypes as string[])]
	};
}
