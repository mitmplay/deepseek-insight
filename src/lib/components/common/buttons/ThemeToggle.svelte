<script lang="ts">
	/**
	 * ThemeToggle — The Three-State Lamp, Wave 3 task 3.1 (ADR-0023).
	 *
	 * The footer-strip mount of the lamp, BEFORE the LanguageMenu pill
	 * (operator decision 2026-10-10 22:21). Follows the LanguageMenu
	 * pattern (Three Tongues W2): ONE trigger button whose icon IS the
	 * current choice — monitor = system, sun = light, moon = dark —
	 * opening a popup with the three states, check on the active one,
	 * click-outside closes, dropUp for the rail-bottom mount.
	 * A thin shell (ADR-0018): the facts live in theme-prefs.
	 */
	import { Monitor, Sun, Moon } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { themePrefs, type ThemeChoice } from '$lib/utils/theme-prefs.svelte';

	let {
		/** Open the list upward (sidebar-footer mount sits at the rail's
		 *  bottom; a downward list leaves the screen). */
		dropUp = false
	}: { dropUp?: boolean } = $props();

	let open = $state(false);
	let rootEl = $state<HTMLElement | null>(null);

	// outside click closes — one window listener while open (LanguageMenu
	// grammar; removed on close/unmount, never a permanent global handler)
	$effect(() => {
		if (!open) return;
		const onDocClick = (ev: MouseEvent) => {
			if (rootEl && !rootEl.contains(ev.target as Node)) open = false;
		};
		document.addEventListener('click', onDocClick);
		return () => document.removeEventListener('click', onDocClick);
	});

	const ICONS = {
		system: Monitor,
		light: Sun,
		dark: Moon
	} as const;

	const LABELS: Record<ThemeChoice, () => string> = {
		system: () => t(m.themeChoice_system),
		light: () => t(m.themeChoice_light),
		dark: () => t(m.themeChoice_dark)
	};

	const CHOICES: ThemeChoice[] = ['system', 'light', 'dark'];

	function choose(c: ThemeChoice): void {
		open = false;
		themePrefs.set(c);
	}
</script>

<div
	class="relative inline-block"
	data-testid="theme-toggle"
	bind:this={rootEl}
>
	<button
		type="button"
		class="flex items-center gap-1 rounded p-1 text-xs font-medium transition-colors hover:bg-surface-hover"
		class:text-[var(--color-accent-purple)]={open}
		title={t(m.themeSettings_label)}
		aria-label={t(m.themeSettings_label)}
		aria-expanded={open}
		data-testid="theme-toggle-trigger"
		onclick={() => (open = !open)}
	>
		{#if themePrefs.choice === 'system'}
			<Monitor size={16} />
		{:else if themePrefs.choice === 'light'}
			<Sun size={16} />
		{:else}
			<Moon size={16} />
		{/if}
	</button>
	{#if open}
		<div
			class="absolute right-0 z-50 w-36 overflow-hidden rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-elevated)] py-1 shadow-md {dropUp ? 'bottom-full mb-1' : 'mt-1'}"
			data-testid="theme-toggle-list"
			role="menu"
		>
			{#each CHOICES as c (c)}
				{@const Icon = ICONS[c]}
				<button
					type="button"
					class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover"
					class:text-[var(--color-accent-purple)]={themePrefs.choice === c}
					class:font-semibold={themePrefs.choice === c}
					data-testid={'theme-option-' + c}
					data-active={themePrefs.choice === c ? 'true' : 'false'}
					role="menuitem"
					onclick={() => choose(c)}
				>
					<span class="flex items-center gap-1.5">
						<Icon size={13} aria-hidden="true" />
						{LABELS[c]()}
					</span>
					{#if themePrefs.choice === c}<span aria-hidden="true">✓</span>{/if}
				</button>
				{/each}
		</div>
	{/if}
</div>
