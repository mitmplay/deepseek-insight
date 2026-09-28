/**
 * plugin-rack stars — repoSlug parses GitHub reff URLs, fetchRackStars maps
 * stargazers_count by plugin id (omitting failures), and formatCompact keeps
 * the badge narrow: 1829 -> '1.8K'.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRackStars, repoSlug } from '../../src/lib/server/plugins/stars';
import { formatCompact } from '../../src/lib/utils/compact-number';

afterEach(() => vi.unstubAllGlobals());

describe('repoSlug', () => {
	it('parses owner/repo from a GitHub reff URL', () => {
		expect(repoSlug('https://github.com/Temoa/dsh-rules-paths')).toBe('Temoa/dsh-rules-paths');
		expect(repoSlug('https://github.com/Temoa/dsh-rules-paths.git')).toBe('Temoa/dsh-rules-paths');
		expect(repoSlug('https://github.com/Temoa/dsh-rules-paths/')).toBe('Temoa/dsh-rules-paths');
	});
	it('rejects non-GitHub and malformed URLs', () => {
		expect(repoSlug('https://gitlab.com/a/b')).toBeNull();
		expect(repoSlug('https://github.com/only-owner')).toBeNull();
		expect(repoSlug('not a url')).toBeNull();
	});
});

describe('fetchRackStars', () => {
	it('maps stargazers_count by plugin id', async () => {
		vi.stubGlobal('fetch', vi.fn((url: string) =>
			Promise.resolve(new Response(JSON.stringify({ stargazers_count: url.includes('Temoa') ? 42 : 7 })))
		));
		const stars = await fetchRackStars([
			{ n: '1', id: 'a', repo: 'https://github.com/Temoa/dsh-rules-paths', author: null, installed: false, bundle: null },
			{ n: '2', id: 'b', repo: 'https://github.com/x/y', author: null, installed: false, bundle: null }
		]);
		expect(stars).toEqual({ a: 42, b: 7 });
	});

	it('omits a plugin whose fetch fails instead of throwing', async () => {
		vi.stubGlobal('fetch', vi.fn((url: string) =>
			String(url).includes('bad')
				? Promise.resolve(new Response('rate limited', { status: 403 }))
				: Promise.resolve(new Response(JSON.stringify({ stargazers_count: 5 })))
		));
		const stars = await fetchRackStars([
			{ n: '1', id: 'bad', repo: 'https://github.com/x/bad', author: null, installed: false, bundle: null },
			{ n: '2', id: 'good', repo: 'https://github.com/x/good', author: null, installed: false, bundle: null }
		]);
		expect(stars).toEqual({ good: 5 });
	});
});

describe('formatCompact', () => {
	it('keeps star badges narrow', () => {
		expect(formatCompact(42)).toBe('42');
		expect(formatCompact(1829)).toBe('1.8K');
		expect(formatCompact(4200000)).toBe('4.2M');
	});
});
