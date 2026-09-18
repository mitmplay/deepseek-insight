/**
 * context-window — resolve a model's context window (tokens) when the
 * DSH wire does not carry one (OCI parity, 2026-08-24).
 *
 * OCI's percentage bar reads `contextWindow` from OpenClaw's model
 * registry; the DSH wire's `session.models` response has NO window
 * field (models carry only id/name/description/reasoning), so DSI
 * resolves the limit client-side instead:
 *
 *   1. localStorage `dsi-ctx-windows` — a user override map, highest
 *      precedence (JSON: `{ "glm-5.2": 200000 }`). Read at call time;
 *      a corrupt blob silently loses to the table below.
 *   2. BUILT_INS — substring patterns for well-known models, longest
 *      (most specific) pattern first. Numbers are public specs; the
 *      glm-5.2 entry mirrors the operator's own OCI provider config
 *      (`contextWindow: 1000000`) so both dashboards show the same
 *      percentage for the same session.
 *
 * Unknown model → undefined → ContextConsumption keeps its honest
 * `≈Nk ctx` text fallback (a bar against a guessed denominator is a
 * lie; a label without one is just less).
 */

/** Ordered substring patterns — most specific first (match wins). */
const BUILT_INS: ReadonlyArray<{ readonly pattern: string; readonly window: number }> = [
	{ pattern: 'glm-5', window: 1_000_000 },
	{ pattern: 'glm-4.6', window: 200_000 },
	{ pattern: 'glm-4.5', window: 128_000 },
	{ pattern: 'glm-4', window: 128_000 },
	{ pattern: 'deepseek-reasoner', window: 128_000 },
	{ pattern: 'deepseek-chat', window: 128_000 },
	{ pattern: 'deepseek', window: 128_000 },
	{ pattern: 'claude-opus-4', window: 200_000 },
	{ pattern: 'claude-sonnet-4', window: 200_000 },
	{ pattern: 'claude-3', window: 200_000 },
	{ pattern: 'claude', window: 200_000 },
	{ pattern: 'gpt-4.1', window: 1_000_000 },
	{ pattern: 'gpt-4o', window: 128_000 },
	{ pattern: 'gpt-5', window: 400_000 },
	{ pattern: 'kimi-k2', window: 256_000 }
];

/** localStorage key for the user's override map (model → window). */
export const CTX_WINDOW_OVERRIDES_KEY = 'dsi-ctx-windows';

/** Parse the override map; corrupt/absent → empty map (never throws). */
function readOverrides(): Record<string, number> {
	if (typeof localStorage === 'undefined') return {};
	try {
		const raw = localStorage.getItem(CTX_WINDOW_OVERRIDES_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
		const out: Record<string, number> = {};
		for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
		}
		return out;
	} catch {
		return {};
	}
}

/**
 * Resolve a model's context window. Exact-id override first, then the
 * built-in substring table (case-insensitive). `undefined` when the
 * model is unknown — the caller keeps its no-limit fallback.
 */
export function contextWindowOf(modelId: string | null | undefined): number | undefined {
	if (!modelId) return undefined;
	const overrides = readOverrides();
	if (overrides[modelId] !== undefined) return overrides[modelId];
	const needle = modelId.toLowerCase();
	for (const entry of BUILT_INS) {
		if (needle.includes(entry.pattern)) return entry.window;
	}
	return undefined;
}
