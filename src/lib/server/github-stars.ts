/**
 * GitHub star counts for shelf/rack registries. Best-effort: a failed or
 * absent fetch simply omits the entry — never breaks the snapshot. Results
 * are cached in-memory for an hour (GitHub's unauthenticated ceiling is
 * 60 req/h per IP).
 */

const STAR_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { count: number; at: number }>();

/** Repo URL -> 'owner/repo'. Tolerates deep URLs like
 *  https://github.com/cursor/plugins/tree/main/pstack/skills (the shelf's
 *  SKR reff lines point at subfolders, not the repo root). */
export function repoSlugFromUrl(repoUrl: string): string | null {
	try {
		const u = new URL(repoUrl);
		if (u.hostname !== 'github.com') return null;
		const seg = u.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
		if (seg.length < 2) return null;
		const [owner, repo] = seg;
		if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
		return owner + '/' + repo;
	} catch {
		return null;
	}
}

export async function fetchRepoStars(slug: string): Promise<number | null> {
	const hit = cache.get(slug);
	if (hit && Date.now() - hit.at < STAR_TTL_MS) return hit.count;
	try {
		const res = await fetch('https://api.github.com/repos/' + slug, {
			headers: { accept: 'application/vnd.github+json', 'user-agent': 'deepseek-insight' },
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) return null;
		const body = (await res.json()) as { stargazers_count?: number };
		if (typeof body.stargazers_count !== 'number') return null;
		cache.set(slug, { count: body.stargazers_count, at: Date.now() });
		return body.stargazers_count;
	} catch {
		return null;
	}
}

/** Star counts keyed by the caller's key; an entry whose fetch failed
 *  (rate limit, private/moved repo, offline, non-GitHub URL) is absent. */
export async function fetchStarsByKey(items: Array<{ key: string; repo: string }>): Promise<Record<string, number>> {
	const stars: Record<string, number> = {};
	await Promise.all(
		items.map(async ({ key, repo }) => {
			const slug = repoSlugFromUrl(repo);
			if (!slug) return;
			const count = await fetchRepoStars(slug);
			if (count !== null) stars[key] = count;
		})
	);
	return stars;
}
