/**
 * verify-ui-i18n lint self-test — Three Tongues W3 task 3.1-T.
 * Fixtures prove the gate discriminates: a raw label is rejected with
 * file/line; the sanctioned {m.*} form, whitelisted tokens, and the
 * i18n-skip marker pass.
 */
import { describe, it, expect } from 'vitest';
import { findViolationsInSource } from '../../scripts/verify-ui-i18n';

describe('verify-ui-i18n lint (3.1)', () => {
	it('rejects a raw text node with file/line info', () => {
		const out = findViolationsInSource('<div><p>Hello brave world</p></div>');
		expect(out.length).toBe(1);
		expect(out[0].reason).toBe('raw text node');
		expect(out[0].line).toBe(1);
		expect(out[0].text).toContain('Hello brave world');
	});

	it('rejects copy-bearing attributes (title, aria-label, placeholder)', () => {
		const out = findViolationsInSource(
			'<input placeholder="Search prompts…" title="Attach images" aria-label="Close panel" />'
		);
		expect(out.length).toBe(3);
		expect(out.every((v) => v.reason.startsWith('copy-bearing'))).toBe(true);
	});

	it('passes the sanctioned {m.key()} expression form', () => {
		const src = '<div><p>{m.save()}</p><input title={m.attachImages()} /></div>';
		expect(findViolationsInSource(src)).toEqual([]);
	});

	it('whitelists immutable tokens and non-natural fragments', () => {
		const src = '<div><span>A</span><span>KB</span><span>42</span><span>{expr}</span></div>';
		expect(findViolationsInSource(src)).toEqual([]);
	});

	it('honors the i18n-skip line marker', () => {
		const src = ['<div>', '<!-- i18n-skip: brand -->', '<span>Workspace - deepseek-insight</span>', '</div>'].join('\n');
		expect(findViolationsInSource(src)).toEqual([]);
	});
});
