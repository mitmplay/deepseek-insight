/**
 * clipboard — copy helpers with visual feedback (OCI port, 2026-08-22).
 *
 * Pure-ish functions: async clipboard write + callback-driven feedback state;
 * no Svelte, no DOM beyond navigator.clipboard. The BubbleCopyButton /
 * CanvasCopyButton rows use these for their idle → done → idle cycle.
 */

/** Copy text to the clipboard; `onCopied(true)` on success for ~2s, false on error. */
export async function copyWithFeedback(
	text: string,
	onCopied: (copied: boolean) => void,
	timeoutMs = 2000
): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		onCopied(true);
		setTimeout(() => onCopied(false), timeoutMs);
	} catch {
		onCopied(false);
	}
}

/**
 * Thin boolean-result write for callers that own their feedback surface
 * (Workspace Explorer W2 task 2.2): resolves true when the clipboard took
 * the text, false on ANY failure (permission denied, focus loss, no API) —
 * the panel turns false into a visible "copy failed" note; never silent.
 */
export async function copyText(value: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(value);
		return true;
	} catch {
		return false;
	}
}
