/**
 * CopyButton unit tests — the copy-to-clipboard icon button with 2s ✓
 * feedback:
 *
 *   - a successful write flips Copy → Check (green) and reverts after the
 *     2s timeout; a failed write keeps the idle Copy icon
 *   - an `onclick` prop fires with the event BEFORE the write and the
 *     click never bubbles past the button; an omitted onclick is optional
 *   - title/class/size passthrough with their defaults
 */

import { flushSync } from 'svelte';
import { mount, unmount, type ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CopyButton from '$lib/components/common/buttons/CopyButton.svelte';

type WriteText = (text: string) => Promise<void>;

/** Stub navigator.clipboard.writeText with vi.spyOn (happy-dom may lack it). */
function stubWriteText(impl: WriteText): { writeText: ReturnType<typeof vi.fn<WriteText>> } {
	const holder = navigator as Navigator & { clipboard?: { writeText: WriteText } };
	let writeText: ReturnType<typeof vi.fn<WriteText>>;
	if (holder.clipboard) {
		writeText = vi.spyOn(holder.clipboard, 'writeText').mockImplementation(impl);
	} else {
		writeText = vi.fn<WriteText>(impl);
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText }
		});
	}
	return { writeText };
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

function mountButton(props: Partial<ComponentProps<typeof CopyButton>> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(CopyButton, {
		target,
		props: { value: 'copy me', ...props } as ComponentProps<typeof CopyButton>
	});
	flushSync();
	return { target, comp };
}

/** Microtask-only settle — shares a clock with fake timers. */
async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

describe('CopyButton — the copied feedback cycle', () => {
	it('a click writes the value and flips the icon to the green Check', async () => {
		const { writeText } = stubWriteText((t) => Promise.resolve());
		const { target, comp } = mountButton({ value: 'the payload' });
		const btn = target.querySelector('[data-testid="copy-text-button"]') as HTMLButtonElement;
		expect(btn.querySelector('svg')?.classList.contains('lucide-check')).toBe(false);
		btn.click();
		await settle();
		expect(writeText).toHaveBeenCalledTimes(1);
		expect(writeText.mock.calls[0][0]).toBe('the payload');
		const check = btn.querySelector('svg');
		expect(check?.classList.contains('lucide-check')).toBe(true);
		expect(check?.classList.contains('text-green-500')).toBe(true);
		unmount(comp);
	});

	it('the Check reverts to the Copy icon after the 2s feedback window', async () => {
		vi.useFakeTimers();
		stubWriteText(() => Promise.resolve());
		const { target, comp } = mountButton();
		const btn = target.querySelector('[data-testid="copy-text-button"]') as HTMLButtonElement;
		btn.click();
		await settle();
		expect(btn.querySelector('svg')?.classList.contains('lucide-check')).toBe(true);
		await vi.advanceTimersByTimeAsync(2000);
		await settle();
		expect(btn.querySelector('svg')?.classList.contains('lucide-check')).toBe(false);
		expect(btn.querySelector('svg')?.classList.contains('lucide-copy')).toBe(true);
		unmount(comp);
	});

	it('a failed clipboard write keeps the idle Copy icon (onCopied(false))', async () => {
		stubWriteText(() => Promise.reject(new Error('denied')));
		const { target, comp } = mountButton();
		const btn = target.querySelector('[data-testid="copy-text-button"]') as HTMLButtonElement;
		btn.click();
		await settle();
		const icon = btn.querySelector('svg');
		expect(icon?.classList.contains('lucide-check')).toBe(false);
		expect(icon?.classList.contains('lucide-copy')).toBe(true);
		unmount(comp);
	});
});

describe('CopyButton — host chaining and chrome', () => {
	it('an onclick prop fires with the event and the click stops at the button', async () => {
		const { writeText } = stubWriteText(() => Promise.resolve());
		const onclick = vi.fn();
		const { target, comp } = mountButton({ onclick });
		// Svelte's delegated walk runs inside the mount-target listener, so
		// the stopPropagation only shields ANCESTORS — observe on the body.
		const rowClicks: Event[] = [];
		document.body.addEventListener('click', (e) => rowClicks.push(e));
		const btn = target.querySelector('[data-testid="copy-text-button"]') as HTMLButtonElement;
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		await settle();
		expect(onclick).toHaveBeenCalledTimes(1);
		expect(onclick.mock.calls[0][0]).toBeInstanceOf(MouseEvent);
		expect(writeText).toHaveBeenCalledTimes(1);
		expect(rowClicks).toHaveLength(0);
		unmount(comp);
	});

	it('the default chrome: title Copy, size 12, no extra class', () => {
		const { target, comp } = mountButton();
		const btn = target.querySelector('[data-testid="copy-text-button"]') as HTMLButtonElement;
		expect(btn.getAttribute('title')).toBe('Copy');
		const icon = btn.querySelector('svg');
		expect(icon?.getAttribute('width')).toBe('12');
		expect(icon?.getAttribute('height')).toBe('12');
		expect(btn.className).toBe('');
		unmount(comp);
	});

	it('title, class, and size props reach the button and the icon', () => {
		const { target, comp } = mountButton({ title: 'Copy markdown', class: 'p-1', size: 18 });
		const btn = target.querySelector('[data-testid="copy-text-button"]') as HTMLButtonElement;
		expect(btn.getAttribute('title')).toBe('Copy markdown');
		expect(btn.classList.contains('p-1')).toBe(true);
		const icon = btn.querySelector('svg');
		expect(icon?.getAttribute('width')).toBe('18');
		expect(icon?.getAttribute('height')).toBe('18');
		unmount(comp);
	});
});
