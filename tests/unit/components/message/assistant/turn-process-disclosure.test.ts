/**
 * TurnProcessDisclosure tests (Fold Gate task 3.1-T) — the fold line's
 * render contract (ADR-0010): label joins the count families with DSH
 * parity ("N tool calls · M messages · K subagents"), zero counts render
 * the "thought for a while" fallback, the toggle callback fires exactly
 * once per click, and aria-expanded tracks the open prop.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TurnProcessDisclosure from '$lib/components/message/assistant/TurnProcessDisclosure.svelte';

function mountRow(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const ontoggle = vi.fn();
	const comp = mount(TurnProcessDisclosure, {
		target,
		props: {
			toolCallCount: 5,
			messageCount: 4,
			subagentCount: 0,
			open: false,
			ontoggle,
			...props
		}
	});
	flushSync();
	const row = () => target.querySelector('[data-testid="turn-process-disclosure"]') as HTMLButtonElement | null;
	const label = () =>
		(target.querySelector('[data-testid="turn-process-label"]')?.textContent ?? '').trim();
	return { target, comp, row, label, ontoggle };
}

afterEach(() => {
	// mounts are unmounted by each test via cleanup below
});

describe('TurnProcessDisclosure — label variants', () => {
	it('joins the families: "5 tool calls · 4 messages"', () => {
		const { label } = mountRow();
		expect(label()).toBe('5 tool calls · 4 messages');
	});

	it('singular forms: "1 tool call · 1 message · 1 subagent"', () => {
		const { label } = mountRow({ toolCallCount: 1, messageCount: 1, subagentCount: 1 });
		expect(label()).toBe('1 tool call · 1 message · 1 subagent');
	});

	it('subagents ride the label when present', () => {
		const { label } = mountRow({ toolCallCount: 2, messageCount: 0, subagentCount: 3 });
		expect(label()).toBe('2 tool calls · 3 subagents');
	});

	it('all-zero counts render the fallback label', () => {
		const { label } = mountRow({ toolCallCount: 0, messageCount: 0, subagentCount: 0 });
		expect(label()).toBe('thought for a while');
	});
});

describe('TurnProcessDisclosure — toggle contract', () => {
	it('click fires ontoggle exactly once', async () => {
		const { row, ontoggle, comp } = mountRow();
		row()!.click();
		expect(ontoggle).toHaveBeenCalledTimes(1);
		await unmount(comp);
	});

	it('aria-expanded tracks the open prop in both states', async () => {
		const a = mountRow({ open: false });
		expect(a.row()!.getAttribute('aria-expanded')).toBe('false');
		const b = mountRow({ open: true });
		expect(b.row()!.getAttribute('aria-expanded')).toBe('true');
		await unmount(a.comp);
		await unmount(b.comp);
	});

	it('a real SVG chevron icon prefixes the label and rotates when open', async () => {
		const closed = mountRow({ open: false });
		const svg = closed.row()!.querySelector('svg');
		expect(svg).not.toBeNull();
		expect(svg!.classList.contains('rotate-90')).toBe(false);
		await unmount(closed.comp);
		const open = mountRow({ open: true });
		expect(open.row()!.querySelector('svg')!.classList.contains('rotate-90')).toBe(true);
		await unmount(open.comp);
	});
});
