/**
 * plugin-rack — GitHub star counts for the reff plugins. Thin adapter over
 * the generic github-stars helper, keyed by plugin id.
 */
import { fetchStarsByKey, repoSlugFromUrl } from '../github-stars';
import type { RackPlugin } from './types';

export type RackStars = Record<string, number>;

export function repoSlug(repoUrl: string): string | null {
	return repoSlugFromUrl(repoUrl);
}

/** Star counts keyed by plugin id; a plugin whose stars could not be
 *  fetched (rate limit, private/moved repo, offline) is simply absent. */
export async function fetchRackStars(plugins: RackPlugin[]): Promise<RackStars> {
	return fetchStarsByKey(plugins.map((p) => ({ key: p.id, repo: p.repo })));
}
