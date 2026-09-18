/**
 * dsh-file-type branch arms (coverage pass 2026-09-14): the classification
 * chain's untaken arms — no-dot basenames, exact-name hits, prefix hits
 * (dockerfile. / .env.), suffix hits (.component.ts / .dockerfile),
 * code-extension hits, traditional-extension hits, and the full-miss
 * 'other' fallback — plus the isCodeFileType guard both ways.
 */
import { describe, it, expect } from 'vitest';
import { classifyFileType, isCodeFileType } from '$lib/components/panels/dsh-file-type';

describe('dsh-file-type — classification chain arms', () => {
	it('a basename with NO dot falls to the exact table or other (fileExtension empty arm)', () => {
		expect(classifyFileType('makefile')).toBe('makefile');
		expect(classifyFileType('Dockerfile')).toBe('docker');
		expect(classifyFileType('README')).toBe('markdown'); // NAME_TYPES fallback
		expect(classifyFileType('artifact-xyz-9')).toBe('other');
	});

	it('exact code names beat extensions', () => {
		expect(classifyFileType('.bashrc')).toBe('shell');
		expect(classifyFileType('.gitignore')).toBe('git');
		expect(classifyFileType('package.json')).toBe('node');
	});

	it('prefix hits: dockerfile.* and .env.*', () => {
		expect(classifyFileType('dockerfile.prod')).toBe('docker');
		expect(classifyFileType('.env.local')).toBe('env');
	});

	it('suffix hits: angular scaffolding and .dockerfile', () => {
		expect(classifyFileType('app.component.ts')).toBe('angular');
		expect(classifyFileType('user.service.ts')).toBe('angular');
		expect(classifyFileType('deploy.dockerfile')).toBe('docker');
	});

	it('code extensions resolve through the code table', () => {
		expect(classifyFileType('a.ts')).toBe('typescript');
		expect(classifyFileType('b.py')).toBe('python');
		expect(classifyFileType('c.rs')).toBe('rust');
	});

	it('traditional extensions resolve only when code rules miss', () => {
		expect(classifyFileType('readme.md')).toBe('markdown');
		expect(classifyFileType('logo.svg')).toBe('image');
		expect(classifyFileType('clip.mp4')).toBe('video');
	});

	it('a full miss is other; the guard splits code from presentation kinds', () => {
		expect(classifyFileType('x.weird')).toBe('other');
		expect(isCodeFileType(classifyFileType('a.ts'))).toBe(true);
		expect(isCodeFileType(classifyFileType('readme.md'))).toBe(false);
	});
});
