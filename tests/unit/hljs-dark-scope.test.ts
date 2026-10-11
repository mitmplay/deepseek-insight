import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Wave 1 task 1.3-T (ADR-0023 / The Three-State Lamp): the dark syntax
// palette must exist ONLY scoped under html[data-theme="dark"], generated
// from the installed github-dark.css - never hand-tuned, never unscoped.

const appCss = readFileSync('src/app.css', 'utf8');
const ghDark = readFileSync('node_modules/highlight.js/styles/github-dark.css', 'utf8');

const scopedBlock = appCss.slice(
	appCss.indexOf('/* Wave 1 task 1.3'),
	appCss.indexOf('/* Dark palette WCAG contrast table')
);

describe('hljs dark scoping (task 1.3 / 1.3-T)', () => {
	it('scopes the github-dark base under the dark attribute', () => {
		expect(scopedBlock).toContain('[data-theme="dark"] .hljs {');
		expect(scopedBlock).toContain('color: #c9d1d9');
		expect(scopedBlock).toContain('background: #0d1117');
	});

	it('carries the installed github-dark token colors verbatim', () => {
		const colors = new Set([...ghDark.matchAll(/#\w{3,6}\b/g)].map((m) => m[0].toLowerCase()));
		const blockLower = scopedBlock.toLowerCase();
		for (const c of colors) {
			expect(blockLower, 'missing github-dark color ' + c).toContain(c);
		}
	});

	it('never leaks an unscoped .hljs rule from app.css itself', () => {
		const unscoped = [...appCss.matchAll(/^\s*\.hljs[^"]*$/gm)].filter(
			(m) => !m[0].includes('[data-theme="dark"]')
		);
		expect(unscoped, unscoped.map((m) => m[0]).join('\n')).toEqual([]);
	});

	it('keeps the light github.css as the unscoped default import', () => {
		expect(appCss).toContain("@import 'highlight.js/styles/github.css';");
		expect(appCss).not.toContain("github-dark.css'");
	});
});
