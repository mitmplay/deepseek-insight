/**
 * PromptInput × Command Help integration (command-help, 2026-08-30):
 * typing a known command with `?` as its entire first argument opens the
 * help card above the textarea; Enter never sends a `?` line (button or
 * key); Esc hides while the text keeps matching; editing re-arms; the
 * finder/`!` triggers never open the card. The 2026-08-30 extension adds
 * the HOST vocabulary: a declined `/token ?` draft resolves against the
 * cached catalog (the same one the menu reads) and renders the wire's
 * own copy — with the send guard held even while unresolved.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PromptInput from '$lib/components/chat/PromptInput.svelte';
import type { SlashDirectory } from '$lib/services/chat/slash-directory.svelte';

const HOST_CATALOG: SlashDirectory = {
	commands: [
		{ name: 'compact', description: 'Compact the session context' },
		{ name: 'plan', description: 'Plan the next turn', input: { hint: '<goal>' } }
	],
	skills: [
		{ name: 'dsh-doc', description: 'Answer from the DSH docs', modelInvocable: true },
		{
			name: 'compact',
			description: 'Compact — the skill twin (collision fixture)',
			modelInvocable: false
		}
	],
	state: 'ready'
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	fetchMock.mockClear();
	vi.unstubAllGlobals();
});

function mountInput(
	onsubmit: (text: string, images: unknown[]) => boolean | Promise<boolean>,
	extra: Record<string, unknown> = {}
) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(PromptInput, {
		target,
		props: { onsubmit, oncancel: () => {}, isStreaming: false, sending: false, ...extra }
	});
	flushSync();
	const textarea = () => target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
	const send = () => target.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
	const help = () => target.querySelector('[data-testid="command-help"]');
	const helpText = () => help()?.textContent ?? '';
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, comp, textarea, send, help, helpText, cleanup };
}

/** Type into the textarea and fire the input event (native-like). */
function type(h: ReturnType<typeof mountInput>, text: string): void {
	const ta = h.textarea();
	ta.value = text;
	ta.selectionStart = ta.selectionEnd = text.length;
	ta.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

/** Dispatch a keydown on the textarea (Svelte handler receives it). */
function key(h: ReturnType<typeof mountInput>, keyName: string): KeyboardEvent {
	const ev = new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true });
	h.textarea().dispatchEvent(ev);
	flushSync();
	return ev;
}

describe('PromptInput × CommandHelpCard', () => {
	it('typing "/new ?" opens the help card with the usage line', () => {
		const h = mountInput(vi.fn(() => true));
		type(h, '/new ?');
		expect(h.help()).not.toBeNull();
		expect(h.helpText()).toContain('/new [@agent]');
		h.cleanup();
	});

	it('typing "/permission ?" and "@abc ?" opens their topics', () => {
		const h = mountInput(vi.fn(() => true));
		type(h, '/permission ?');
		expect(h.helpText()).toContain('/permission [preset]');
		type(h, '@abc ?');
		expect(h.helpText()).toContain('@<session-id> <message>');
		h.cleanup();
	});

	it('Enter never sends a ? help line and keeps the draft + card', async () => {
		const onsubmit = vi.fn(() => true);
		const h = mountInput(onsubmit);
		type(h, '/new ?');
		const ev = key(h, 'Enter');
		await Promise.resolve();
		flushSync();
		expect(ev.defaultPrevented).toBe(true);
		expect(onsubmit).not.toHaveBeenCalled();
		expect(h.textarea().value).toBe('/new ?');
		expect(h.help()).not.toBeNull();
		h.cleanup();
	});

	it('the Send button never sends a ? help line either', async () => {
		const onsubmit = vi.fn(() => true);
		const h = mountInput(onsubmit);
		type(h, '/permission ?');
		expect(h.send().disabled).toBe(false);
		h.send().click();
		await Promise.resolve();
		flushSync();
		expect(onsubmit).not.toHaveBeenCalled();
		expect(h.textarea().value).toBe('/permission ?');
		h.cleanup();
	});

	it('Esc hides the card; the draft survives; editing re-arms it', () => {
		const h = mountInput(vi.fn(() => true));
		type(h, '/new ?');
		expect(h.help()).not.toBeNull();
		key(h, 'Escape');
		expect(h.help()).toBeNull();
		expect(h.textarea().value).toBe('/new ?');
		// A longer (non-matching) draft resets the memo…
		type(h, '/new ? x');
		// …so re-typing the exact help shape re-arms the card.
		type(h, '/new ?');
		expect(h.help()).not.toBeNull();
		h.cleanup();
	});

	it('Enter after the card is dismissed re-opens it and still never submits', async () => {
		const onsubmit = vi.fn(() => true);
		const h = mountInput(onsubmit);
		type(h, '/new ?');
		key(h, 'Escape');
		expect(h.help()).toBeNull();
		const ev = key(h, 'Enter');
		await Promise.resolve();
		flushSync();
		expect(ev.defaultPrevented).toBe(true);
		expect(onsubmit).not.toHaveBeenCalled();
		expect(h.help()).not.toBeNull();
		h.cleanup();
	});

	it('ordinary text and finder triggers never open the card', async () => {
		const onsubmit = vi.fn(() => true);
		const h = mountInput(onsubmit);
		type(h, '?load');
		expect(h.help()).toBeNull();
		type(h, 'run /new ?');
		expect(h.help()).toBeNull();
		// Ordinary text submits exactly as before.
		type(h, 'hello world');
		key(h, 'Enter');
		await Promise.resolve();
		flushSync();
		expect(onsubmit).toHaveBeenCalledWith('hello world', []);
		h.cleanup();
	});
});

describe('PromptInput × CommandHelpCard — host vocabulary (catalog-fed)', () => {
	it('typing "/plan ?" opens the card with the wire copy: hint usage + command tag + run-path note', () => {
		const onsubmit = vi.fn(() => true);
		const h = mountInput(onsubmit, { slashCatalog: HOST_CATALOG });
		type(h, '/plan ?');
		expect(h.help()).not.toBeNull();
		expect(h.helpText()).toContain('/plan <goal>');
		expect(h.helpText()).toContain('command');
		expect(h.helpText()).toContain('Plan the next turn');
		expect(h.helpText()).toContain('never reaches the model');
		h.cleanup();
	});

	it('Enter never sends a host ? line — not to the model, not to commands/execute', async () => {
		const onsubmit = vi.fn(() => true);
		const h = mountInput(onsubmit, { slashCatalog: HOST_CATALOG });
		type(h, '/plan ?');
		key(h, 'Enter');
		await Promise.resolve();
		flushSync();
		expect(onsubmit).not.toHaveBeenCalled(); // the prompt pipe never sees it
		expect(h.textarea().value).toBe('/plan ?'); // the draft is the operator's
		expect(h.help()).not.toBeNull();
		h.cleanup();
	});

	it('a skill ? renders the skill tag; the collision resolves to the COMMAND card', () => {
		const h = mountInput(vi.fn(() => true), { slashCatalog: HOST_CATALOG });
		type(h, '/dsh-doc ?');
		expect(h.helpText()).toContain('/dsh-doc');
		expect(h.helpText()).toContain('skill');
		expect(h.helpText()).toContain('the host injects the skill body');
		type(h, '/compact ?'); // name in BOTH catalogs — the command wins
		expect(h.helpText()).toContain('Compact the session context');
		expect(h.helpText()).toContain('command');
		h.cleanup();
	});

	it('an unknown token gets no card — and its Enter is still swallowed (a ? line never rides the wire)', async () => {
		const onsubmit = vi.fn(() => true);
		const h = mountInput(onsubmit, { slashCatalog: HOST_CATALOG });
		type(h, '/nope ?');
		expect(h.help()).toBeNull();
		const ev = key(h, 'Enter');
		await Promise.resolve();
		flushSync();
		expect(ev.defaultPrevented).toBe(true);
		expect(onsubmit).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('with NO catalog yet the ? shape still owns its keys (nothing resolves, nothing sends)', async () => {
		const onsubmit = vi.fn(() => true);
		const h = mountInput(onsubmit); // slashCatalog absent
		type(h, '/plan ?');
		expect(h.help()).toBeNull();
		key(h, 'Enter');
		await Promise.resolve();
		flushSync();
		expect(onsubmit).not.toHaveBeenCalled();
		expect(h.textarea().value).toBe('/plan ?');
		h.cleanup();
	});
});
