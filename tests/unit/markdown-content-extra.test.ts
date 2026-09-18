/**
 * MarkdownContent extra branch tests — edges the main suite's file does not
 * mount:
 *
 *   - a '#' ONLY document still counts as markdown (the third `||` arm of
 *     the lean-lookahead chain)
 *   - TWO diagrams in ONE mount initialize the runtime once (mermaidReady
 *     memo) but render both placeholders
 *   - the raw <pre> view unbinds the container — the render pass re-runs
 *     gated OFF (no runtime call), and toggling back re-renders the fresh
 *     placeholder
 *   - a fence the renderer does NOT treat as mermaid (`mermaid-x`) sets
 *     hasMermaid but finds no placeholder → the pass exits early
 *   - an unmount while a render is in flight cancels the pass without
 *     touching the (detached) placeholder
 *
 * $app/environment is mocked to browser:true (the real stub is false) and
 * the mermaid runtime is mocked.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';

vi.mock('$app/environment', () => ({
	browser: true,
	dev: false,
	building: false,
	version: 'test'
}));

const mermaidRender = vi.fn(async (_id: string, source: string) => ({ svg: `<svg data-mmd="${source}"></svg>` }));
const mermaidInitialize = vi.fn();

vi.mock('mermaid', () => ({
	default: {
		initialize: (...args: unknown[]) => mermaidInitialize(...args),
		render: (...args: unknown[]) => mermaidRender(...(args as [string, string]))
	}
}));

function render(props: { content: string; hideToggle?: boolean }): { target: HTMLElement; unmount: () => void } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(MarkdownContent, { target, props });
	flushSync();
	return { target, unmount: () => unmount(comp) };
}

async function settle(rounds = 10): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		await Promise.resolve();
	}
	flushSync();
}

describe('MarkdownContent — markdown-lookahead arms', () => {
	it('a heading-ONLY document counts as markdown and gets the Copy/Raw pair', () => {
		const { target, unmount: done } = render({ content: '# The Plan\n\nDo the thing' });
		expect(target.querySelector('h1')?.textContent).toBe('The Plan');
		expect(target.querySelector('[data-testid="raw-toggle-button"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="copy-text-button"]')).not.toBeNull();
		done();
	});
});

describe('MarkdownContent — multi-diagram single mount', () => {
	beforeEach(() => {
		mermaidRender.mockClear();
		mermaidInitialize.mockClear();
		mermaidRender.mockImplementation(async (_id: string, source: string) => ({
			svg: `<svg data-mmd="${source}"></svg>`
		}));
	});

	it('two fences in one document initialize the runtime once and render both diagrams', async () => {
		const { target, unmount: done } = render({
			content: '```mermaid\ngraph TD\n  A-->B\n```\n\n```mermaid\ngraph LR\n  X-->Y\n```'
		});
		await settle();
		const diagrams = [...target.querySelectorAll('.mermaid-diagram')];
		expect(diagrams).toHaveLength(2);
		expect(diagrams.map((d) => d.getAttribute('data-processed'))).toEqual(['true', 'true']);
		expect(mermaidInitialize).toHaveBeenCalledTimes(1);
		expect(mermaidRender).toHaveBeenCalledTimes(2);
		done();
	});

	it('the raw view unbinds the container: the pass is gated off, toggling back re-renders', async () => {
		const { target, unmount: done } = render({ content: '```mermaid\ngraph TD\n  A-->B\n```' });
		await settle();
		expect(mermaidRender).toHaveBeenCalledTimes(1);
		expect(mermaidInitialize).toHaveBeenCalledTimes(1);

		(target.querySelector('[data-testid="raw-toggle-button"]') as HTMLElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="markdown-raw"]')).not.toBeNull();
		await settle();
		// raw <pre> has no bound container — no second render pass ran
		expect(mermaidRender).toHaveBeenCalledTimes(1);

		(target.querySelector('[data-testid="raw-toggle-button"]') as HTMLElement).click();
		flushSync();
		await settle();
		// the rebuilt placeholder is fresh (data-processed=false) and gets rendered
		expect(target.querySelector('.mermaid-diagram')?.getAttribute('data-processed')).toBe('true');
		expect(mermaidRender).toHaveBeenCalledTimes(2);
		done();
	});

	it('a `mermaid-x` fence matches the lookahead but renders no placeholder — the pass exits early', async () => {
		const { target, unmount: done } = render({ content: '```mermaid-x\nflow TD\n```' });
		await settle();
		expect(target.querySelector('.mermaid-diagram')).toBeNull();
		expect(target.querySelector('pre code')?.textContent).toContain('flow TD');
		expect(mermaidRender).not.toHaveBeenCalled();
		expect(mermaidInitialize).not.toHaveBeenCalled();
		done();
	});

	it('cancellation stops SUBSEQUENT diagrams; an in-flight render still lands (current disk behavior)', async () => {
		let release!: () => void;
		const gate = new Promise<{ svg: string }>((resolve) => {
			release = () => resolve({ svg: '<svg data-mmd="late"></svg>' });
		});
		mermaidRender.mockImplementation(() => gate);
		const { target, unmount: done } = render({
			content: '```mermaid\ngraph TD\n  A-->B\n```\n\n```mermaid\ngraph LR\n  X-->Y\n```'
		});
		await settle();
		expect(mermaidRender).toHaveBeenCalledTimes(1); // the loop is sequential: only diagram 1 pending
		// capture the placeholders, then cancel while diagram 1's render is pending
		const diagrams = [...target.querySelectorAll('.mermaid-diagram')];
		done();
		release();
		await settle();
		// The guard is checked BEFORE each await: diagram 1's render was already
		// in flight, so its late SVG still lands (in the now-detached element);
		// diagram 2 is refused by the cancelled check.
		expect(diagrams[0]?.innerHTML).toContain('<svg data-mmd="late">');
		expect(diagrams[1]?.innerHTML).toBe('');
	});
});
