import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/lib/utils/markdown';

// 2026-10-11 operator bug: the destination regex rejected WHITESPACE, so
// CommonMark angle-bracket destinations containing spaces — the ONLY way
// to link a path with spaces, e.g. spec folders and ADR files — rendered
// as raw text, including inside GFM table cells.

const ANGLE_LINK = '[ADR-0023 — The Three-State Lamp](<dev/architectural-decission/2026-10/2026-10-10 - ADR-0023 — The Three-State Lamp — System, Light, Dark, One Token Set.md>)';

describe('angle-bracket destinations with spaces (2026-10-11)', () => {
	it('links an angle destination containing spaces in prose', () => {
		const html = renderMarkdown(ANGLE_LINK);
		console.log('PROSE HTML:', html); // debug
		expect(html).toContain('<a href="dev/architectural-decission/2026-10/2026-10-10 - ADR-0023 — The Three-State Lamp — System, Light, Dark, One Token Set.md">');
		expect(html).toContain('>ADR-0023 — The Three-State Lamp</a>');
		// the raw text must NOT survive as literal content
		expect(html).not.toContain('[ADR-0023 — The Three-State Lamp](');
	});

	it('links inside GFM table cells — the table path runs renderInline too', () => {
		// two columns — the documented GFM rule (markdown.ts: 2+ cells; the
		// 2026-08-26 header-less-table fix records the boundary)
		const md = [
			'| Artifact | Where |',
			'| --- | --- |',
			'| ' + ANGLE_LINK + ' | dev/specs |'
		].join('\n');
		const html = renderMarkdown(md);
		expect(html).toContain('<table>');
		expect(html).toContain('<a href="dev/architectural-decission/2026-10/2026-10-10 - ADR-0023 — The Three-State Lamp — System, Light, Dark, One Token Set.md">');
		expect(html).not.toContain('[ADR-0023');
		expect(html).toContain('<table>');
	});

	it('http(s) angle destinations keep the external hardening', () => {
		const html = renderMarkdown('[docs](<https://example.com/a b.html>)');
		expect(html).toContain('rel="noopener noreferrer" target="_blank"');
	});

	it('an angle destination with a scheme stays inert text (BC-12)', () => {
		const html = renderMarkdown('[x](<javascript:alert(1)>)');
		expect(html).not.toContain('<a href="javascript');
	});

	it('the legacy bare no-space form still links', () => {
		expect(renderMarkdown('[route](/api/dsh/sessions)')).toContain('<a href="/api/dsh/sessions">route</a>');
	});
});
