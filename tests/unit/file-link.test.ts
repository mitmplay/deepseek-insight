/** File Link Intent W1.1-T — pins for the shared predicates (PRD Task 1.1). */
import { describe, expect, it } from 'vitest';
import { isFileLinkHref, normalizeFileLinkPath, parseFileLinkHref } from '../../src/lib/utils/file-link';

describe('isFileLinkHref', () => {
	it('accepts scheme-free relative paths', () => {
		expect(isFileLinkHref('deepseek-insight/src/lib/utils/file-link.ts')).toBe(true);
		expect(isFileLinkHref('src/a.ts#L153')).toBe(true);
		expect(isFileLinkHref('./src/a.ts')).toBe(true);
		expect(isFileLinkHref('/workspace/src/a.ts')).toBe(true);
	});
	it('refuses external and scheme-carrying hrefs', () => {
		expect(isFileLinkHref('https://example.com/x')).toBe(false);
		expect(isFileLinkHref('http://example.com')).toBe(false);
		expect(isFileLinkHref('javascript:alert(1)')).toBe(false);
		expect(isFileLinkHref('data:text/html,x')).toBe(false);
		expect(isFileLinkHref('mailto:a@b.c')).toBe(false);
		expect(isFileLinkHref('//evil.example/x')).toBe(false);
	});
	it('refuses DSI own capability surface', () => {
		expect(isFileLinkHref('/api/dsh/sessions')).toBe(false);
	});
	it('refuses empty', () => {
		expect(isFileLinkHref('')).toBe(false);
		expect(isFileLinkHref('   ')).toBe(false);
	});
});

describe('normalizeFileLinkPath', () => {
	it('strips ./ prefix, leading slash, collapses duplicate slashes', () => {
		expect(normalizeFileLinkPath('./src/a.ts')).toBe('src/a.ts');
		expect(normalizeFileLinkPath('/workspace/src/a.ts')).toBe('workspace/src/a.ts');
		expect(normalizeFileLinkPath('src//a.ts')).toBe('src/a.ts');
		expect(normalizeFileLinkPath('deepseek-insight/src/a.ts#L153')).toBe('deepseek-insight/src/a.ts');
	});
	it('refuses workspace escapes with null', () => {
		expect(normalizeFileLinkPath('../secrets')).toBeNull();
		expect(normalizeFileLinkPath('src/../../../etc/passwd')).toBeNull();
	});
	it('refuses empty results', () => {
		expect(normalizeFileLinkPath('./')).toBeNull();
		expect(normalizeFileLinkPath('')).toBeNull();
	});
	describe('parseFileLinkHref', () => {
		it('splits a single #L anchor into path + line', () => {
			const r = parseFileLinkHref('src/lib/components/terminal/TerminalDesk.svelte#L139');
			expect(r.path).toBe('src/lib/components/terminal/TerminalDesk.svelte');
			expect(r.lines).toEqual({ start: 139, end: 139 });
		});
		it('parses a #L range anchor', () => {
			const r = parseFileLinkHref('src/a.ts#L10-L20');
			expect(r.lines).toEqual({ start: 10, end: 20 });
		});
		it('returns null lines without an anchor or on a malformed one', () => {
			expect(parseFileLinkHref('src/a.ts').lines).toBeNull();
			expect(parseFileLinkHref('src/a.ts#fragment').lines).toBeNull();
			expect(parseFileLinkHref('src/a.ts#L0').lines).toBeNull();
			expect(parseFileLinkHref('src/a.ts#L20-L10').lines).toBeNull();
		});
		it('normalizes the path part', () => {
			expect(parseFileLinkHref('./src//a.ts#L3').path).toBe('src/a.ts');
		});
	});
});
