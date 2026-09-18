<script lang="ts">
	/**
	 * Language menu — Three Tongues W2 task 2.2 (ADR 2026-09-12); bug-fix
	 * pass 2026-09-12: theme-token styling (the app is LIGHT — the first
	 * dark neutral-900 dropdown read as a black box), click-open/close
	 * state (closes on selection and outside click, replacing the fragile
	 * hover-only CSS dropdown), and a dropUp prop so the sidebar-footer
	 * mount opens upward instead of off-screen.
	 *
	 * All copy comes from the catalogs through m.*; state and persistence
	 * live in the shared locale-state service — this component only
	 * renders and calls setLocale (cookie persistence, no network; the
	 * settings-panel row is the surface that PUTs the yaml default).
	 *
	 * Font pattern follows the sidebar's create button
	 * (data-testid="new-chat-button"): text-xs font-medium.
	 */
	import { Languages } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';
	import { currentLocale, setLocale, t } from '$lib/services/locale/locale-state.svelte';
	import { UI_LOCALES } from '$lib/config';

	let {
		/** Open the list upward (sidebar-footer mount — it sits at the
		 *  bottom of the rail; a downward list leaves the screen). */
		dropUp = false
	}: { dropUp?: boolean } = $props();

	let open = $state(false);
	let rootEl = $state<HTMLElement | null>(null);

	// outside click closes — one window listener while open (removed on
	// close/unmount; never a permanent global handler)
	$effect(() => {
		if (!open) return;
		const onDocClick = (ev: MouseEvent) => {
			if (rootEl && !rootEl.contains(ev.target as Node)) open = false;
		};
		document.addEventListener('click', onDocClick);
		return () => document.removeEventListener('click', onDocClick);
	});

	// Native names are NOT translated copy — every locale shows every
	// name in its own language (the point of a language menu).
	const NATIVE_NAMES: Record<string, string> = {
		en: 'English',
		zh: '中文',
		id: 'Bahasa Indonesia',
		es: 'Español'
	};

	async function choose(loc: (typeof UI_LOCALES)[number]): Promise<void> {
		open = false;
		await setLocale(loc);
	}
</script>

<div
	class="relative inline-block"
	data-testid="language-menu"
	bind:this={rootEl}
>
	<button
		type="button"
		class="flex items-center gap-1 rounded p-1 text-xs font-medium transition-colors hover:bg-surface-hover"
		class:text-[var(--color-accent-purple)]={open}
		title={t(m.languageMenu_label)}
		aria-label={t(m.languageMenu_label)}
		aria-expanded={open}
		data-testid="language-menu-trigger"
		onclick={() => (open = !open)}
	>
		<Languages size={16} />
		<span class="uppercase">{currentLocale()}</span>
	</button>
	{#if open}
		<div
			class="absolute right-0 z-50 w-36 overflow-hidden rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-elevated)] py-1 shadow-md {dropUp ? 'bottom-full mb-1' : 'mt-1'}"
			data-testid="language-menu-list"
			role="menu"
		>
			{#each UI_LOCALES as loc (loc)}
				<button
					type="button"
					class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover"
					class:text-[var(--color-accent-purple)]={currentLocale() === loc}
					class:font-semibold={currentLocale() === loc}
					data-testid={'locale-option-' + loc}
					data-active={currentLocale() === loc ? 'true' : 'false'}
					role="menuitem"
					onclick={() => choose(loc)}
				>
					{NATIVE_NAMES[loc]}
					{#if currentLocale() === loc}<span aria-hidden="true">✓</span>{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
