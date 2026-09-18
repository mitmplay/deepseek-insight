/**
 * Root layout load — operator config before the first component mounts.
 *
 * ~/.dsi/settings.yaml arrives via GET /api/config (app-config store,
 * singleton): the layout's default values (panel/sidebar widths, poll
 * cadences, prompt clamp) are read synchronously at mount, so awaiting the
 * ONE fetch here means they land before any reader runs — no flash of code
 * defaults, no layout jump. SSR skips (a relative fetch has no origin
 * server-side); client hydration re-runs this load before render.
 */

import { browser } from '$app/environment';
import { loadAppConfig } from '$lib/services/config/app-config.svelte';

import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async () => {
	if (browser) await loadAppConfig();
	return {};
};
