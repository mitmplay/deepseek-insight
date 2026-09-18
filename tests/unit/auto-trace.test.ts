import { describe, it, expect } from 'vitest';
import { autoTrace } from '$lib/preprocess/auto-trace.js';

/**
 * Unit tests for the auto-trace Svelte preprocessor — data-svelte injection
 * on root elements, branch traversal (if/each/await), dedup when already
 * tagged, naming rules (DSI routes: +layout/+page/+error variants),
 * svelte:head skipping, and non-svelte skips.
 *
 * Ported from openclaw-insight tests/lib/preprocess/auto-trace.test.ts.
 */

const pp = autoTrace();

function markup(content: string, filename = 'src/lib/components/Foo.svelte') {
	return pp.markup({ content, filename });
}

describe('autoTrace preprocessor', () => {
	it('injects data-svelte on a plain root element', () => {
		const out = markup('<div>hi</div>');
		expect(out?.code).toBe('<div data-svelte="Foo">hi</div>');
	});

	it('names +layout as LayoutRoot and +page as the conversation floor', () => {
		expect(markup('<main></main>', 'src/routes/+layout.svelte')?.code).toContain(
			'data-svelte="LayoutRoot"'
		);
		// One page since the Root-is-the-Floor ADR (2026-09-02): the root
		// IS the floor — the former HomePage label is retired with it.
		expect(markup('<main></main>', 'src/routes/+page.svelte')?.code).toContain(
			'data-svelte="ConversationPage"'
		);
	});

	it('names +error as ErrorPage', () => {
		expect(
			markup('<main></main>', 'src/routes/+error.svelte')?.code
		).toContain('data-svelte="ErrorPage"');
	});

	it('skips non-svelte files and node_modules', () => {
		expect(markup('<div/>', 'src/lib/foo.ts')).toBeUndefined();
		expect(markup('<div/>', 'node_modules/pkg/Foo.svelte')).toBeUndefined();
	});

	it('skips syntax errors (compiler owns those)', () => {
		expect(markup('<div><span>unclosed', 'src/lib/components/Broken.svelte')).toBeUndefined();
	});

	it('does not double-inject when data-svelte is already present', () => {
		// Zero inserts → the preprocessor returns undefined (markup unchanged)
		const out = markup('<div data-svelte="Manual">x</div>');
		expect(out).toBeUndefined();
	});

	it('tags elements inside if/each branches (and else branches)', () => {
		const src = `{#if a}<p>one</p>{:else}<span>two</span>{/if}`;
		const out = markup(src);
		expect(out?.code).toContain('<p data-svelte="Foo">one</p>');
		expect(out?.code).toContain('<span data-svelte="Foo">two</span>');
		const src2 = `{#each xs as x}<li>{x}</li>{/each}`;
		const out2 = markup(src2);
		expect(out2?.code).toContain('<li data-svelte="Foo">');
	});

	it('skips components (capitalized) and applies multiple inserts by reverse position', () => {
		const src = '<div><Child/><p>a</p><span>b</span></div>';
		const out = markup(src);
		expect(out?.code).toContain('<Child/>'); // untouched
		expect(out?.code).toContain('data-svelte'); // roots tagged
		expect(out?.code.startsWith('<div data-svelte="Foo"')).toBe(true);
	});

	it('skips svelte:head — DSI pages use it; it must never carry the attribute', () => {
		const src = '<svelte:head><title>t</title></svelte:head>\n<main>hi</main>';
		const out = markup(src, 'src/routes/+page.svelte');
		expect(out?.code).not.toContain('<svelte:head data-svelte');
		expect(out?.code).toContain('<main data-svelte="ConversationPage">hi</main>');
	});

	it('skips await branches correctly (pending/then/catch children)', () => {
		const src = `{#await promise}<p>loading</p>{:then v}<span>{v}</span>{/await}`;
		const out = markup(src);
		expect(out?.code).toContain('<p data-svelte="Foo">loading</p>');
		expect(out?.code).toContain('<span data-svelte="Foo">');
	});
});
