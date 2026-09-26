/**
 * MarkdownContent unit tests — the shared markdown surface's two paths
 * (full with hover Copy/Raw pair, lean hideToggle) plus the search-term
 * highlight pass and the lazy mermaid diagram swap.
 *
 * $app/environment is mocked to browser:true (the real stub is false —
 * the mermaid pass is browser-gated) and the mermaid runtime is mocked
 * (the component lazy-imports ~1.4 MB of it on first diagram).
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

/** Mounted render in a live-dom div; `unmount` rides the returned element
 *  (tests call `target.unmount()` — the type says so, Object.assign adds it). */
function render(props: {
	content: string;
	small?: boolean;
	hideToggle?: boolean;
	searchTerm?: string;
}): HTMLElement & { unmount(): void } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(MarkdownContent, { target, props });
	return Object.assign(target, { unmount: () => unmount(comp) });
}

async function settle(rounds = 10): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		await Promise.resolve();
	}
	flushSync();
}

describe('MarkdownContent — render paths', () => {
	it('full path: markdown-looking content gets the hover Copy/Raw pair; the toggle swaps to raw', async () => {
		const target = render({ content: 'Cost is **~1–3%** of tokens.' });
		expect(target.querySelector('[data-testid="copy-text-button"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="raw-toggle-button"]')).not.toBeNull();
		expect(target.querySelector('.md-content strong')?.textContent).toBe('~1–3%');

		(target.querySelector('[data-testid="raw-toggle-button"]') as HTMLElement).click();
		flushSync();
		const raw = target.querySelector('[data-testid="markdown-raw"]');
		expect(raw).not.toBeNull();
		expect(raw?.textContent).toBe('Cost is **~1–3%** of tokens.'); // verbatim source
		(target.unmount as () => void)();
	});

	it('plain text stays lean: rendered, but no Copy/Raw action row', async () => {
		const target = render({ content: 'just words here' });
		expect(target.querySelector('.md-content')?.textContent).toBe('just words here');
		expect(target.querySelector('[data-testid="copy-text-button"]')).toBeNull();
		expect(target.querySelector('[data-testid="raw-toggle-button"]')).toBeNull();
		expect(target.querySelector('.relative.group\\/markdown')).not.toBeNull(); // full-path wrapper still present
		(target.unmount as () => void)();
	});

	it('hideToggle renders the lean path: bare md-content, no wrapper even for markdown', async () => {
		const target = render({ content: '`code` and **bold**', hideToggle: true });
		expect(target.querySelector('.md-content code')).not.toBeNull();
		expect(target.querySelector('[data-testid="copy-text-button"]')).toBeNull();
		expect(target.querySelector('.relative')).toBeNull();
		(target.unmount as () => void)();
	});

	it('a RegExp-hostile environment (lookbehind-free browser) degrades to unhighlighted html', async () => {
		// The catch exists for engines that reject lookbehind (old Safari).
		// Simulate one: a RegExp subclass that throws on our probe term.
		const RealRegExp = RegExp;
		vi.stubGlobal(
			'RegExp',
			class extends RealRegExp {
				constructor(pattern: string, flags?: string) {
					// happy-dom's parser passes non-string patterns — pass those through.
					if (typeof pattern === 'string' && pattern.includes('LOOKBEHIND'))
						throw new SyntaxError('Invalid regular expression');
					super(pattern, flags);
				}
			}
		);
		try {
			const target = render({ content: 'solid **text**', searchTerm: 'LOOKBEHIND' });
			expect(target.querySelector('mark')).toBeNull(); // pass refused…
			expect(target.querySelector('.md-content')?.textContent).toContain('solid'); // …content still renders
			(target.unmount as () => void)();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('blockquote-only content counts as markdown (the ">" lookahead operand)', async () => {
		const target = render({ content: 'a plain line\n\n> quoted wisdom' });
		expect(target.querySelector('blockquote')?.textContent).toContain('quoted wisdom');
		expect(target.querySelector('[data-testid="raw-toggle-button"]')).not.toBeNull();
		(target.unmount as () => void)();
	});

	it('small flips the text size class', async () => {
		const small = render({ content: 'hi', small: true });
		expect(small.querySelector('.md-content')?.className).toContain('text-xs');
		(small.unmount as () => void)();
		const normal = render({ content: 'hi' });
		expect(normal.querySelector('.md-content')?.className).toContain('text-sm');
		(normal.unmount as () => void)();
	});
});

describe('MarkdownContent — search highlight', () => {
	it('a search term gets a mark in the RENDERED html, after markdown rendering', async () => {
		const target = render({ content: 'The **widget** rocks', searchTerm: 'widget' });
		const mark = target.querySelector('mark');
		expect(mark).not.toBeNull();
		expect(mark?.textContent).toBe('widget');
		expect(mark?.className).toContain('bg-accent-blue/30');
		expect(mark?.closest('strong')).not.toBeNull(); // highlighted INSIDE the strong
		(target.unmount as () => void)();
	});

	it('regex-special terms are escaped — no throw, literal match only', async () => {
		const target = render({ content: 'a.b+c* is fun', searchTerm: 'a.b+c' });
		expect(target.querySelector('mark')?.textContent).toBe('a.b+c');
		(target.unmount as () => void)();
	});

	it('no term (blank) skips the pass entirely', async () => {
		const target = render({ content: 'plain **text**', searchTerm: '   ' });
		expect(target.querySelector('mark')).toBeNull();
		expect(target.querySelector('strong')).not.toBeNull();
		(target.unmount as () => void)();
	});

	it('a term touching a word boundary inside a tag name is not highlighted (lookarounds)', async () => {
		const target = render({ content: '**strong** text', searchTerm: 'strong' });
		// the opening <strong> tag itself must survive as markup, not gain a mark inside the tag
		expect(target.querySelector('strong')).not.toBeNull();
		expect(target.querySelectorAll('mark').length).toBeLessThanOrEqual(1);
		(target.unmount as () => void)();
	});
});

describe('MarkdownContent — mermaid lazy swap', () => {
	beforeEach(() => {
		mermaidRender.mockClear();
		mermaidInitialize.mockClear();
		mermaidRender.mockImplementation(async (_id: string, source: string) => ({
			svg: `<svg data-mmd="${source}"></svg>`
		}));
	});

	it('a mermaid fence becomes the rendered SVG (placeholder processed exactly once)', async () => {
		const target = render({ content: 'before\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nafter' });
		await settle();
		const diagram = target.querySelector('.mermaid-diagram') as HTMLElement;
		expect(diagram).not.toBeNull();
		expect(diagram.getAttribute('data-processed')).toBe('true');
		expect(diagram.querySelector('svg[data-mmd]')).not.toBeNull();
		expect(mermaidRender).toHaveBeenCalledTimes(1);
		// the decoded source, not the base64, reached the runtime
		expect(mermaidRender.mock.calls[0][1]).toContain('graph TD');
		expect(mermaidInitialize).toHaveBeenCalledTimes(1);
		expect(mermaidInitialize).toHaveBeenCalledWith(
			expect.objectContaining({ startOnLoad: false, securityLevel: 'strict' })
		);
		(target.unmount as () => void)();
	});

	it('two mounts both swap their diagrams through the mocked runtime', async () => {
		const first = render({ content: '```mermaid\ngraph TD\n  A-->B\n```' });
		await settle();
		expect(first.querySelector('.mermaid-diagram')?.getAttribute('data-processed')).toBe('true');
		expect(mermaidRender).toHaveBeenCalledTimes(1);
		(first.unmount as () => void)();

		const second = render({ content: '```mermaid\ngraph LR\n  X-->Y\n```' });
		await settle();
		expect(second.querySelector('.mermaid-diagram')?.getAttribute('data-processed')).toBe('true');
		expect(mermaidRender).toHaveBeenCalledTimes(2);
		(second.unmount as () => void)();
	});

	it('a render error degrades to the error card, still marked processed', async () => {
		mermaidRender.mockImplementation(async () => {
			throw new Error('Parse error on line 2');
		});
		const target = render({ content: '```mermaid\nnot a diagram\n```' });
		await settle();
		const diagram = target.querySelector('.mermaid-diagram') as HTMLElement;
		expect(diagram.getAttribute('data-processed')).toBe('true');
		expect(diagram.textContent).toContain('Mermaid render error: Error: Parse error on line 2');
		(target.unmount as () => void)();
	});

	it('non-mermaid content never imports the runtime', async () => {
		const target = render({ content: '**bold** only' });
		await settle();
		expect(mermaidRender).not.toHaveBeenCalled();
		(target.unmount as () => void)();
	});
});
