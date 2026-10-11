<script lang="ts">
	/**
	 * ThemeSettingsRow — The Three-State Lamp, Wave 3 task 3.1 (ADR-0023).
	 *
	 * The settings-floor mount of the three-state lamp, placed BEFORE the
	 * LanguageMenu row (operator decision 2026-10-10 22:21). A thin shell
	 * (ADR-0018): every fact lives in theme-prefs — this row renders its
	 * store and writes choices through it. The pre-paint script (app.html)
	 * already themed first paint; a change here flips the attribute live.
	 */
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { themePrefs, type ThemeChoice } from '$lib/utils/theme-prefs.svelte';

	const CHOICES: ThemeChoice[] = ['system', 'light', 'dark'];
	const LABELS: Record<ThemeChoice, () => string> = {
		system: () => t(m.themeChoice_system),
		light: () => t(m.themeChoice_light),
		dark: () => t(m.themeChoice_dark)
	};

	function onchange(event: Event): void {
		const next = (event.currentTarget as HTMLSelectElement).value;
		if (next === 'system' || next === 'light' || next === 'dark') themePrefs.set(next);
	}
</script>

<div class="flex items-center gap-2 text-sm" data-testid="theme-settings-row">
	<label class="text-[var(--color-text-secondary)]" for="theme-select">{t(m.themeSettings_label)}</label>
	<select
		id="theme-select"
		class="rounded border border-[var(--color-surface-border)] bg-[var(--color-surface-elevated)] px-2 py-1 text-[var(--color-text-primary)]"
		data-testid="theme-select"
		{onchange}
	>
		{#each CHOICES as c (c)}
			<option value={c} selected={themePrefs.choice === c}>{LABELS[c]()}</option>
		{/each}
	</select>
</div>
