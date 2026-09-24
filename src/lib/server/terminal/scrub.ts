/**
 * Child-environment scrub for DSI's terminal sessions — a deliberate
 * mechanism-copy of DSH's `scrubbedParentEnv` with one ownership-specific
 * change: DSI strips its own `DSI_*` namespace too (ADR 2026-09-23 D6).
 *
 * Credential-shaped names and both reserved namespaces must never reach a
 * terminal the operator can type into; explicitly supplied entries merge
 * AFTER the scrub, so a deliberate opt-in survives. Case-insensitive
 * matching because Windows environment names are case-insensitive.
 * The proxy overlay re-applies after the strip so a child behind a proxied
 * parent routes the same way.
 * @mirrors deepseek-harness/packages/subprocess/subprocess/src/index.ts:47-80
 */

/** Namespace prefixes reserved by the harness and by DSI — neither leaks
 *  into a child implicitly. */
const RESERVED_PREFIXES = ['DSH_', 'DSI_'] as const;

/** Credential-shaped environment names are NOT forwarded to children. */
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;

function isReserved(key: string): boolean {
	const upper = key.toUpperCase();
	return RESERVED_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/**
 * The ambient parent environment minus credential-shaped names and minus
 * every `DSH_*`/`DSI_*` name — the base every DSI terminal child
 * starts from. `PATH`, `HOME`, locale, and proxy variables survive,
 * so child shells run normally.
 * @param explicit - deliberate caller entries merged after the scrub; a
 *   string is an opt-in that survives, `undefined` is a tombstone that
 *   removes an ordinary ambient entry.
 * @returns a fresh environment object safe to hand to a PTY child.
 */
export function scrubbedChildEnv(
	explicit?: Record<string, string | undefined> | undefined
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && !SENSITIVE_ENV_PATTERN.test(key) && !isReserved(key)) {
			env[key] = value;
		}
	}
	if (explicit !== undefined) {
		for (const [key, value] of Object.entries(explicit)) {
			if (value === undefined) Reflect.deleteProperty(env, key);
			else env[key] = value;
		}
	}
	return env;
}
