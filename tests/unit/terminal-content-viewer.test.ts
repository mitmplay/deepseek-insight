/**
 * TerminalContentViewer (2026-09-05): the settled dispatch text block —
 * terminal vs generic chrome, the failed ring/badge, the source flip
 * (output ⇄ raw arguments), and the no-output placeholder.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import TerminalContentViewer from '$lib/components/common/viewers/TerminalContentViewer.svelte';

type Props = {
	toolName: string;
	content?: string;
	isError?: boolean;
	terminal?: boolean;
	subTool?: string;
	source?: string;
};

function mountViewer(props: Props) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(TerminalContentViewer, { target, props });
	flushSync();
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('TerminalContentViewer', () => {
	it('terminal family: amber ring, terminal testid, sub-tool stamped', () => {
		const h = mountViewer({ toolName: 'bash', content: 'ok', subTool: 'bash' });
		const root = h.target.querySelector('[data-testid="code-dispatch-terminal"]') as HTMLElement;
		expect(root).not.toBeNull();
		expect(root.className).toContain('ring-amber-200');
		expect(root.getAttribute('data-sub-tool')).toBe('bash');
		expect(root.textContent).toContain('ok');
		h.cleanup();
	});

	it('generic fallback: slate ring, generic testid', () => {
		const h = mountViewer({ toolName: 'mystery', content: 'x', terminal: false });
		const root = h.target.querySelector('[data-testid="code-dispatch-generic"]') as HTMLElement;
		expect(root).not.toBeNull();
		expect(root.className).toContain('ring-slate-200');
		expect(root.className).not.toContain('ring-amber-200');
		h.cleanup();
	});

	it('a failed call adds the red ring, data-error, and the failed badge', () => {
		const h = mountViewer({ toolName: 'bash', content: 'boom', isError: true });
		const root = h.target.querySelector('[data-testid="code-dispatch-terminal"]') as HTMLElement;
		expect(root.className).toContain('ring-red-300');
		expect(root.getAttribute('data-error')).toBe('true');
		expect(root.textContent).toContain('failed');
		// The content stays visible through the failure chrome
		expect(root.textContent).toContain('boom');
		h.cleanup();
	});

	it('undefined content renders the honest (no output) placeholder', () => {
		const h = mountViewer({ toolName: 'bash' });
		expect(h.target.textContent).toContain('(no output)');
		h.cleanup();
	});

	it('with a source, the toggle flips output ⇄ raw arguments; without one it stays output-only', async () => {
		const h = mountViewer({ toolName: 'bash', content: 'the output', source: '{"command":"ls"}' });
		expect(h.target.querySelector('pre')?.textContent).toBe('the output');
		const toggle = h.target.querySelector('[data-testid="raw-toggle-button"]') as HTMLButtonElement | null;
		expect(toggle).not.toBeNull();
		toggle!.click();
		flushSync();
		expect(h.target.querySelector('[data-testid="code-dispatch-source"]')?.textContent).toBe('{"command":"ls"}');
		h.cleanup();

		const bare = mountViewer({ toolName: 'bash', content: 'only output' });
		expect(bare.target.querySelectorAll('[data-testid="code-dispatch-actions"] button')).toHaveLength(1); // Copy only
		bare.cleanup();
	});
});
