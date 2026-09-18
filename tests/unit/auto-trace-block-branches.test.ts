/**
 * auto-trace preprocessor — block-walk arms the main suite's fixtures miss:
 * the each `{:else}` branch, the await `{:catch}` branch, and the missing-
 * filename guard arm. Each pin keeps injected `data-svelte` names flowing
 * into every render branch of a component (dev DOM→component mapping).
 */
import { describe, expect, it } from 'vitest';
import { autoTrace } from '$lib/preprocess/auto-trace.js';

const pp = autoTrace();

function markup(content: string, filename = 'src/lib/components/Foo.svelte') {
	return pp.markup({ content, filename });
}

describe('autoTrace block-walk arms', () => {
	it('tags elements inside an each {:else} branch (the empty-list render)', () => {
		const src = '{#each xs as x}<li>{x}</li>{:else}<em>none</em>{/each}';
		const out = markup(src);
		expect(out?.code).toContain('<em data-svelte="Foo">none</em>');
		expect(out?.code).toContain('<li data-svelte="Foo">');
	});

	it('tags elements inside an await {:catch} branch (the failed-load render)', () => {
		const src = '{#await p}<i>load</i>{:then v}<b>{v}</b>{:catch e}<u>{e.message}</u>{/await}';
		const out = markup(src);
		expect(out?.code).toContain('<i data-svelte="Foo">load</i>');
		expect(out?.code).toContain('<b data-svelte="Foo">');
		expect(out?.code).toContain('<u data-svelte="Foo">');
	});

	it('markup without a filename is skipped (the guard runs before any parse)', () => {
		expect(pp.markup({ content: '<div>hi</div>', filename: undefined })).toBeUndefined();
	});

	it('an if block WITHOUT an else branch walks its children (no else walk)', () => {
		const out = markup('{#if ready}<p>only</p>{/if}');
		expect(out?.code).toContain('<p data-svelte="Foo">only</p>');
	});

	it('an await block WITHOUT a pending block walks then (pending walk skipped)', () => {
		const out = markup('{#await p}{:then v}<b>{v}</b>{/await}');
		expect(out?.code).toContain('<b data-svelte="Foo">');
	});

	it('an await block WITHOUT a then block walks pending + catch (then walk skipped)', () => {
		const out = markup('{#await p}<i>load</i>{:catch e}<u>{e.message}</u>{/await}');
		expect(out?.code).toContain('<i data-svelte="Foo">load</i>');
		expect(out?.code).toContain('<u data-svelte="Foo">');
	});
});
