/**
 * clipboard unit tests — copyWithFeedback's idle → done → idle cycle
 * (OCI port). Fake timers drive the 2s reset; the clipboard API is
 * stubbed on navigator (happy-dom has none) for both outcomes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText, copyWithFeedback } from '$lib/utils/clipboard';

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
	vi.useFakeTimers();
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText }
	});
});

afterEach(() => {
	vi.useRealTimers();
	writeText.mockReset();
});

describe('copyWithFeedback', () => {
	it('success: onCopied(true) immediately, false after the timeout', async () => {
		writeText.mockResolvedValue(undefined);
		const states: boolean[] = [];
		const done = copyWithFeedback('copy me', (c) => states.push(c));
		await vi.advanceTimersByTimeAsync(0);
		expect(states).toEqual([true]);
		await vi.advanceTimersByTimeAsync(2000);
		expect(states).toEqual([true, false]);
		await done;
	});

	it('failure: onCopied(false) once, no timer armed', async () => {
		writeText.mockRejectedValue(new Error('denied'));
		const states: boolean[] = [];
		await copyWithFeedback('copy me', (c) => states.push(c));
		expect(states).toEqual([false]);
		await vi.advanceTimersByTimeAsync(5000);
		expect(states).toEqual([false]); // no late flip
	});

	it('a custom timeout honors the caller’s cadence', async () => {
		writeText.mockResolvedValue(undefined);
		const states: boolean[] = [];
		copyWithFeedback('x', (c) => states.push(c), 500);
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(500);
		expect(states).toEqual([true, false]);
	});
});

describe('copyText (Workspace Explorer W2 task 2.2-T)', () => {
	it('resolves true on a successful write, with no feedback side effects', async () => {
		writeText.mockResolvedValue(undefined);
		await expect(copyText('/tmp/ws/README.md')).resolves.toBe(true);
		expect(writeText).toHaveBeenCalledWith('/tmp/ws/README.md');
	});

	it('resolves FALSE on denial — the visible-failure contract, never a throw', async () => {
		writeText.mockRejectedValue(new Error('NotAllowedError'));
		await expect(copyText('/tmp/ws/README.md')).resolves.toBe(false);
	});

	it('passes the VERBATIM value (the full path, unicode included)', async () => {
		writeText.mockResolvedValue(undefined);
		await copyText('/tmp/ws/docs/笔记 文件.md');
		expect(writeText).toHaveBeenCalledWith('/tmp/ws/docs/笔记 文件.md');
	});
});
