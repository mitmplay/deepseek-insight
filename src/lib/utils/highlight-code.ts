/**
 * highlight-code — OCI parity for syntax-highlighted code rendering inside
 * tool-result views (2026-08-22). highlight.js core + a registered subset
 * (the languages DSI transcripts actually carry), with OCI's alias table so
 * fence tags like ```svelte resolve.
 *
 * Escape-first, like the rest of the pipeline (BC-12 cousin): highlight.js
 * escapes its own output, and unknown languages decline to plain escaped
 * text — never raw input into the DOM.
 */

import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);

// OCI alias table (markdown.ts): fence tags → registered languages.
hljs.registerAliases(['svelte', 'vue', 'astro', 'html'], { languageName: 'xml' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' });
hljs.registerAliases(['sh', 'shell'], { languageName: 'bash' });
hljs.registerAliases(['yaml', 'yml'], { languageName: 'json' });
hljs.registerAliases(['md', 'markdown'], { languageName: 'xml' });

/** True when the language tag (or alias) is registered. */
export function isKnownCodeLang(lang: string): boolean {
	return hljs.getLanguage(lang) !== undefined;
}

/** Highlight code with the language's grammar; unknown/failed → escaped text. */
export function highlightCode(code: string, lang: string): string {
	if (!hljs.getLanguage(lang)) {
		return escapeText(code);
	}
	try {
		return hljs.highlight(code, { language: lang }).value;
	} catch {
		return escapeText(code);
	}
}

function escapeText(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}
