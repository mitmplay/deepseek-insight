/**
 * Chat info-row component tests (2026-08-23): TokenCounter live estimate,
 * ContextConsumption display modes, PromptInput's row composition
 * (token · model · context), ModelSelector menuUp direction.
 */
import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import TokenCounter from '$lib/components/chat/TokenCounter.svelte';
import ContextConsumption from '$lib/components/chat/ContextConsumption.svelte';
import PromptInput from '$lib/components/chat/PromptInput.svelte';

function mountInto(component: unknown, props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const comp = mount(component as any, { target, props });
	return { target, comp, cleanup: () => { unmount(comp); target.remove(); } };
}

describe('TokenCounter', () => {
	it('renders the live heuristic estimate of the draft', () => {
		const { target, cleanup } = mountInto(TokenCounter, { text: 'a'.repeat(40) });
		expect(target.querySelector('[data-testid="token-counter"]')?.textContent).toContain('~10 tokens');
		cleanup();
	});
	it('empty draft counts zero', () => {
		const { target, cleanup } = mountInto(TokenCounter, { text: '' });
		expect(target.querySelector('[data-testid="token-counter"]')?.textContent).toContain('~0 tokens');
		cleanup();
	});
});

describe('ContextConsumption — three display modes', () => {
	it('both values → OCI bar + percentage', () => {
		const { target, cleanup } = mountInto(ContextConsumption, { used: 50_000, limit: 100_000 });
		expect(target.textContent).toContain('50%');
		expect(target.querySelector('div > div')).not.toBeNull(); // bar track present
		cleanup();
	});
	it('used only → text label (DSH wire has no window limit yet)', () => {
		const { target, cleanup } = mountInto(ContextConsumption, { used: 12_340 });
		const label = target.querySelector('[data-testid="context-consumption"]');
		expect(label?.textContent).toContain('≈12.3k ctx');
		cleanup();
	});
	it('neither → renders nothing (Svelte leaves only an anchor comment)', () => {
		const { target, cleanup } = mountInto(ContextConsumption, {});
		expect(target.querySelector('[data-testid="context-consumption"]')).toBeNull();
		expect(target.children).toHaveLength(0);
		cleanup();
	});
});

describe('PromptInput info row', () => {
	function input(props: Record<string, unknown> = {}) {
		return mountInto(PromptInput, {
			onsubmit: () => Promise.resolve(),
			oncancel: () => Promise.resolve(),
			isStreaming: false,
			sending: false,
			...props
		});
	}

	it('sessionId mounts the row: token counter left, model selector center, context right', () => {
		const { target, cleanup } = input({ sessionId: 's-1', contextTokens: 12_340 });
		const row = target.querySelector('[data-testid="prompt-info-row"]') as HTMLElement;
		expect(row).not.toBeNull();

		// Left flank is the ADR-0007 cluster span (token counter + access
		// chip seat); model center and context right stay direct children.
		const kids = Array.from(row.children);
		expect(kids[0].querySelector('[data-testid="token-counter"]')).not.toBeNull();
		expect(kids[1].querySelector('[data-testid="model-selector-button"]')).not.toBeNull();
		expect(kids[2].matches('[data-testid="context-consumption"]')).toBe(true);
		expect(row.className).toContain('justify-between');
		// Without permission data the chip stays hidden (lean default).
		expect(target.querySelector('[data-testid="access-mode-chip"]')).toBeNull();
		cleanup();
	});

	it('permission + onpermission mount the access chip beside the token counter (ADR-0007 R4)', () => {
		const { target, cleanup } = input({
			sessionId: 's-1',
			permission: { current: 'workspace-write', options: [{ value: 'workspace-write', label: 'Workspace Write' }] },
			onpermission: () => true
		});
		const row = target.querySelector('[data-testid="prompt-info-row"]') as HTMLElement;
		expect(row).not.toBeNull();
		const flank = row.children[0] as HTMLElement;
		const token = flank.querySelector('[data-testid="token-counter"]') as HTMLElement;
		const chip = flank.querySelector('[data-testid="access-mode-chip"]') as HTMLElement;
		expect(token).not.toBeNull();
		expect(chip).not.toBeNull();
		// Geometry: the chip sits AFTER the counter (beside, not replacing).
		expect(token.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(chip.getAttribute('aria-label')).toBe('Access mode, current: Workspace Write');
		cleanup();
	});

	it('a RUNNING turn never disables the access chip (DSH parity, 2026-08-28)', () => {
		// The pick rides the host-side /permission command wire — it never
		// touches the model or the streaming turn, so isStreaming must not
		// lock it (the old lock made DSI stricter than DSH's own GUI).
		const { target, cleanup } = input({
			sessionId: 's-1',
			isStreaming: true,
			permission: { current: 'workspace-write', options: [{ value: 'workspace-write', label: 'Workspace Write' }] },
			onpermission: () => true
		});
		const chip = target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
		expect(chip).not.toBeNull();
		expect(chip.disabled).toBe(false);
		// The submit window (sending) still locks the footer uniformly.
		const locked = input({
			sessionId: 's-1',
			sending: true,
			permission: { current: 'workspace-write', options: [{ value: 'workspace-write', label: 'Workspace Write' }] },
			onpermission: () => true
		});
		const lockedChip = locked.target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
		expect(lockedChip.disabled).toBe(true);
		locked.cleanup();
		cleanup();
	});

	it('model selector menu opens UPWARD inside the footer (menuUp)', async () => {
		const { target, cleanup } = input({ sessionId: 's-1' });
		const btn = target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement;
		// The models fetch on mount rejects in happy-dom (no server) — the
		// menu still opens with the error path; direction is what we assert.
		btn.click();
		await Promise.resolve();
		const menu = target.querySelector('[data-testid="model-selector-menu"]') as HTMLElement;
		expect(menu).not.toBeNull();
		expect(menu.className).toContain('bottom-full');
		expect(menu.className).not.toContain('top-full');
		cleanup();
	});

	it('no sessionId and no context → no info row (lean mount)', () => {
		const { target, cleanup } = input();
		expect(target.querySelector('[data-testid="prompt-info-row"]')).toBeNull();
		expect(target.querySelector('[data-testid="token-counter"]')).toBeNull();
		cleanup();
	});

	it('typing updates the token counter live', async () => {
		const { target, cleanup } = input({ sessionId: 's-1' });
		const ta = target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
		ta.value = 'a'.repeat(44);
		ta.dispatchEvent(new Event('input'));
		flushSync();
		expect(target.querySelector('[data-testid="token-counter"]')?.textContent).toContain('~11 tokens');
		cleanup();
	});
});
