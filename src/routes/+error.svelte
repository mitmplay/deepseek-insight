<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * App-wide error boundary (the Root-is-the-Floor ADR, 2026-09-02):
	 * 404 (session absent — and any retired address), 503 (host down),
	 * 409 (sub-agent ownership). The way back is `/` itself: a bare
	 * arrival restores the persisted desk, so "back" costs nothing.
	 */
	import { page } from '$app/state';

	const status = $derived(page.status);
	const message = $derived(page.error?.message ?? 'Something went wrong.');
</script>

<!-- i18n-skip: brand, never translated -->
<svelte:head><title>{status} — deepseek-insight</title></svelte:head>

<main class="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center">
	<p class="text-5xl font-semibold text-slate-300" data-testid="error-status">{status}</p>
	{#if status === 404}
		<h1 class="text-xl font-semibold">{t(m.sessionNotFound)}</h1>
		<p class="text-sm text-slate-500" data-testid="error-message">{message}</p>
		<p class="text-xs text-slate-400">{t(m.reapedNote)}</p>
	{:else if status === 503}
		<h1 class="text-xl font-semibold">{t(m.dshUnreachable)}</h1>
		<p class="text-sm text-slate-500" data-testid="error-message">{message}</p>
	{:else}
		<h1 class="text-xl font-semibold">{t(m.unexpectedError)}</h1>
		<p class="text-sm text-slate-500" data-testid="error-message">{message}</p>
	{/if}
	<a
		href="/"
		class="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
		data-testid="error-back-home"
	>
		{t(m.backToWorkspace)}
	</a>
</main>
