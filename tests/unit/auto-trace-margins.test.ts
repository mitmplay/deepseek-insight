import { describe, expect, it } from 'vitest';
import { autoTrace } from '$lib/preprocess/auto-trace.js';

/**
 * Margin tests for the auto-trace preprocessor - attribute-level arms the
 * main suites do not force: spread attributes on a tagged element (the
 * a.type === "Attribute" false arm) and nested plain-element subtrees.
 */

const pp = autoTrace();

function markup(content: string, filename = 'src/lib/components/Foo.svelte') {
	return pp.markup({ content, filename });
}

describe('autoTrace - attribute-arm margins', () => {
	it('still tags an element whose other attributes include a spread', () => {
		const src = '<div {...rest} class="x">hi</div>';
		const out = markup(src);
		expect(out?.code).toContain('<div data-svelte="Foo" {...rest}');
	});

	it('tags the inner element of a nested plain-element tree', () => {
		const out = markup('<section><article>deep</article></section>');
		expect(out?.code).toContain('<section data-svelte="Foo">');
		expect(out?.code).toContain('<article>deep</article>'); // roots only
	});

	it('an already-tagged element is left untouched while siblings get tagged', () => {
		const out = markup('<div><b data-svelte="Manual">k</b><i>i</i></div>');
		expect(out?.code).toContain('<b data-svelte="Manual">');
		expect(out?.code).toContain('<i>i</i>'); // nested elements are not walked
	});

	it('an empty component yields no inserts (undefined returned)', () => {
		expect(markup('')).toBeUndefined();
	});
});
