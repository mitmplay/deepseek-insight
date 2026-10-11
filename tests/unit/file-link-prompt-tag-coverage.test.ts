/** Coverage floor push (2026-10-08): the per-file 80% gate sat exactly at
 *  the floor for file-link.ts and prompt-tag-prefs.ts — this suite covers
 *  the remaining error/edge branches so both clear 85% on every metric. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	hasDotDotSegment,
	isFileLinkHref,
	normalizeFileLinkPath,
	parseFileLinkHref,
	resolveFileLinkPath,
	resolveFileLinkTarget,
	workspaceFileExists,
	workspaceRootDirs
} from '../../src/lib/utils/file-link';
import { loadTagFilter, saveTagFilter } from '../../src/lib/utils/prompt-tag-prefs';

// ── file-link: never-exported-elsewhere predicates ──

describe('hasDotDotSegment (edge inputs)', () => {
	it('detects a literal .. segment only, not lookalikes', () => {
		expect(hasDotDotSegment('a/../b')).toBe(true);
		expect(hasDotDotSegment('..')).toBe(true);
		expect(hasDotDotSegment('a/.../b')).toBe(false);
		expect(hasDotDotSegment('a..b/c')).toBe(false);
		expect(hasDotDotSegment('src/a.ts')).toBe(false);
		expect(hasDotDotSegment('')).toBe(false);
	});
});

describe('isFileLinkHref — uncovered arm shapes', () => {
	it('uppercase scheme variants refused', () => {
		expect(isFileLinkHref('HTTPS://example.com/x')).toBe(false);
		expect(isFileLinkHref('JAVASCRIPT:x')).toBe(false);
	});
	it('a bare / is accepted (leading slash is stripped later)', () => {
		expect(isFileLinkHref('/x')).toBe(true);
	});
	it('/api/ prefix check is a prefix, not a substring', () => {
		expect(isFileLinkHref('api/x')).toBe(true);
		expect(isFileLinkHref('/apiroot/x')).toBe(true);
	});
});

describe('parseFileLinkHref — angle wrappers + bare anchors', () => {
	it('strips angle-bracket destinations (both raw and %3C/%3E forms)', () => {
		expect(parseFileLinkHref('<src/a.ts#L5>').path).toBe('src/a.ts');
		expect(parseFileLinkHref('%3Csrc/a.ts%3E').path).toBe('src/a.ts');
		expect(parseFileLinkHref('<src/a.ts>').lines).toBeNull();
	});
	it('parses the bare #12 and #12-15 anchor variants', () => {
		expect(parseFileLinkHref('src/a.ts#12').lines).toEqual({ start: 12, end: 12 });
		expect(parseFileLinkHref('src/a.ts#12-15').lines).toEqual({ start: 12, end: 15 });
	});
	it('boundary: #L0/#0 and a reversed bare range degrade to null lines', () => {
		expect(parseFileLinkHref('src/a.ts#0').lines).toBeNull();
		expect(parseFileLinkHref('src/a.ts#15-12').lines).toBeNull();
		expect(parseFileLinkHref('src/a.ts#L0-L9').lines).toBeNull();
	});
	it('mixed L forms parse (L12-15, 12-L15)', () => {
		expect(parseFileLinkHref('src/a.ts#L12-15').lines).toEqual({ start: 12, end: 15 });
		expect(parseFileLinkHref('src/a.ts#12-L15').lines).toEqual({ start: 12, end: 15 });
	});
	it('path that normalizes to empty yields path \'\'', () => {
		expect(parseFileLinkHref('./#L3').path).toBe('');
	});
	it('anchor after a stripped wrapper still parses', () => {
		const r = parseFileLinkHref('  <src//a.ts#L3>  ');
		expect(r.path).toBe('src/a.ts');
		expect(r.lines).toEqual({ start: 3, end: 3 });
	});
});

describe('normalizeFileLinkPath — wrapper + escape edges', () => {
	it('angle wrapper around a traversal still refuses', () => {
		expect(normalizeFileLinkPath('<../etc/passwd>')).toBeNull();
	});
	it('anchor stripped before normalization', () => {
		expect(normalizeFileLinkPath('src/a.ts#frag')).toBe('src/a.ts');
		expect(normalizeFileLinkPath('../x#L1')).toBeNull();
	});
	it('%3C prefix only strips when leading, %3E only trailing', () => {
		expect(normalizeFileLinkPath('%3Csrc/a.ts')).toBe('src/a.ts');
		expect(normalizeFileLinkPath('src/a.ts%3E')).toBe('src/a.ts%3E'.slice(0, 8) ? 'src/a.ts%3E'.replace(/(?:%3E|>)$/i, '') : 'src/a.ts');
	});
});

describe('resolveFileLinkPath — remaining arms', () => {
	it('root ~ alone resolves the path as-is', () => {
		expect(resolveFileLinkPath('src/a.ts', '~')).toBe('src/a.ts');
	});
	it('tilde-prefixed root bridges an expanded absolute link', () => {
		expect(resolveFileLinkPath('/home/op/ws/src/a.ts', '~/ws')).toBe('src/a.ts');
	});
	it('segment-marker last resort strips mid-path root folder', () => {
		expect(resolveFileLinkPath('/x/ws/src/a.ts', '~/ws')).toBe('src/a.ts');
	});
	it('path equal to the root returns the original input', () => {
		expect(resolveFileLinkPath('ws', '~/ws')).toBe('ws');
	});
	it('undefined root behaves as blank', () => {
		expect(resolveFileLinkPath('src/a.ts', undefined)).toBe('src/a.ts');
	});
	it('empty path value stays empty', () => {
		expect(resolveFileLinkPath('', '/ws')).toBe('');
		expect(resolveFileLinkPath('//', '/ws')).toBe('');
	});
	it('dot/dotdot basename of root is skipped for the last-resort marker', () => {
		expect(resolveFileLinkPath('/x/../src/a.ts', '~/..')).toBe('x/../src/a.ts');
	});
});

// ── workspaceRootDirs — the untested fetch seam ──

function respond(status: number, body?: unknown) {
	return vi.fn(async () =>
		status === 200
			? new Response(JSON.stringify(body), { status: 200 })
			: new Response('nope', { status })
	) as unknown as typeof fetch;
}

describe('workspaceRootDirs', () => {
	it('filters dir entries from a good listing', async () => {
		const fetchImpl = respond(200, {
			ok: true,
			listing: {
				entries: [
					{ name: 'src', type: 'dir' },
					{ name: 'README.md', type: 'file' },
					{ name: 'notes', type: 'dir' }
				]
			}
		});
		await expect(workspaceRootDirs('s1', fetchImpl)).resolves.toEqual(['src', 'notes']);
	});
	it('non-ok status → []', async () => {
		await expect(workspaceRootDirs('s1', respond(500))).resolves.toEqual([]);
	});
	it('body.ok !== true → []', async () => {
		await expect(workspaceRootDirs('s1', respond(200, { ok: false }))).resolves.toEqual([]);
	});
	it('missing/undefined entries array → []', async () => {
		await expect(workspaceRootDirs('s1', respond(200, { ok: true }))).resolves.toEqual([]);
		await expect(workspaceRootDirs('s1', respond(200, { ok: true, listing: {} }))).resolves.toEqual([]);
	});
	it('transport throw → []', async () => {
		const boom = (async () => {
			throw new Error('down');
		}) as unknown as typeof fetch;
		await expect(workspaceRootDirs('s1', boom)).resolves.toEqual([]);
	});
	it('encodes the sessionId in the URL', async () => {
		const fetchImpl = respond(200, { ok: true, listing: { entries: [] } });
		await workspaceRootDirs('a b?c', fetchImpl);
		expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('sessionId=a%20b%3Fc');
	});
});

describe('workspaceFileExists — remaining arms', () => {
	it('empty path → false with no fetch', async () => {
		const fetchImpl = respond(200, { ok: true, listing: { entries: [] } });
		await expect(workspaceFileExists('s1', '', fetchImpl)).resolves.toBe(false);
		await expect(workspaceFileExists('s1', '#L3', fetchImpl)).resolves.toBe(false);
		expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
	});
	it('malformed body → false', async () => {
		await expect(workspaceFileExists('s1', 'a.ts', respond(200, { ok: true }))).resolves.toBe(false);
	});
});

describe('resolveFileLinkTarget — fallback refusal arms', () => {
	it('listRoot throws → null (drop stands)', async () => {
		const exists = vi.fn(async () => false);
		const listRoot = vi.fn(async () => {
			throw new Error('refused');
		});
		await expect(resolveFileLinkTarget('s1', 'src/a.ts', '/ws', exists, listRoot)).resolves.toBeNull();
	});
	it('resolved with dot-dot skips the deep fallback', async () => {
		const exists = vi.fn(async () => false);
		const listRoot = vi.fn(async () => ['x']);
		await expect(resolveFileLinkTarget('s1', '../a.ts', null, exists, listRoot)).resolves.toBeNull();
		expect(listRoot).not.toHaveBeenCalled();
	});
	it('empty resolved path skips the deep fallback', async () => {
		const exists = vi.fn(async () => false);
		const listRoot = vi.fn(async () => ['x']);
		await expect(resolveFileLinkTarget('s1', '', null, exists, listRoot)).resolves.toBeNull();
		expect(listRoot).not.toHaveBeenCalled();
	});
	it('fallback skips junk dir names and keeps probing', async () => {
		const exists = vi.fn(async (_s: string, p2: string) => p2 === 'ok/src/a.ts');
		const listRoot = vi.fn(async () => ['', '.', '..', 'ok']);
		await expect(resolveFileLinkTarget('s1', 'src/a.ts', null, exists, listRoot)).resolves.toBe('ok/src/a.ts');
	});
});

// ── prompt-tag-prefs — the localStorage seam ──

describe('loadTagFilter / saveTagFilter (localStorage seam)', () => {
	const KEY = 'dsi-prompt-tags-filter';

	beforeEach(() => {
		localStorage.clear();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	it('returns [] when localStorage is undefined (SSR)', () => {
		const store = globalThis.localStorage;
		// @ts-expect-error stub the global away
		delete globalThis.localStorage;
		vi.stubGlobal('localStorage', undefined);
		expect(loadTagFilter(KEY)).toEqual([]);
		expect(saveTagFilter(KEY, ['a'])).toBeUndefined();
		vi.unstubAllGlobals();
		globalThis.localStorage = store;
	});

	it('returns [] on absent key', () => {
		expect(loadTagFilter(KEY)).toEqual([]);
	});

	it('round-trips words and applies profile suffix via dsiKey', () => {
		saveTagFilter(KEY, ['Git', 'rca']);
		expect(localStorage.getItem(KEY)).toBe(JSON.stringify(['Git', 'rca']));
		expect(loadTagFilter(KEY)).toEqual(['git', 'rca']);
		saveTagFilter(KEY, ['widi'], 'prof');
		expect(localStorage.getItem(KEY + '_prof')).toBe(JSON.stringify(['widi']));
		expect(loadTagFilter(KEY, 'prof')).toEqual(['widi']);
	});

	it('junk JSON → []', () => {
		localStorage.setItem(KEY, '{not json');
		expect(loadTagFilter(KEY)).toEqual([]);
	});

	it('non-array JSON → []', () => {
		localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
		expect(loadTagFilter(KEY)).toEqual([]);
		localStorage.setItem(KEY, JSON.stringify('nope'));
		expect(loadTagFilter(KEY)).toEqual([]);
	});

	it('drops non-string, empty, invalid and duplicate words', () => {
		localStorage.setItem(
			KEY,
			JSON.stringify([42, null, '', 'UPPER_CASE', 'has space', 'git', 'GIT', 'ok-1', 'x'.repeat(33)])
		);
		expect(loadTagFilter(KEY)).toEqual(['upper_case', 'git', 'ok-1']);
	});

	it('setItem throwing (quota) is swallowed', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});
		expect(() => saveTagFilter(KEY, ['git'])).not.toThrow();
		vi.restoreAllMocks();
	});

	it('getItem throwing is swallowed → []', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(loadTagFilter(KEY)).toEqual([]);
		vi.restoreAllMocks();
	});
});
