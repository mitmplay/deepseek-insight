<script lang="ts">
	/**
	 * LocaleSettingsRow — Three Tongues W2 task 2.3 (ADR 2026-09-12).
	 *
	 * The settings-panel mount of the switcher, shown only for the dsi
	 * target. The document is the authority (Settings Panel ADR D5): a
	 * change here is a read → yaml-mutate → whole-buffer PUT through the
	 * SAME /api/settings seam the editor uses — never a side-channel
	 * write. The immediate UI flip rides the shared locale-state service;
	 * persistence for future requests is the yaml document itself.
	 */
	import * as m from '$lib/paraglide/messages';
	import { UI_LOCALES } from '$lib/config';
	import { parse } from 'yaml';
	import { setLocale, currentLocale, t } from '$lib/services/locale/locale-state.svelte';

	let saving = $state(false);
	let errorNote = $state<string | null>(null);

	// Native names are NOT translated copy — every locale shows every
	// name in its own language.
	const NATIVE_NAMES: Record<string, string> = {
		en: 'English',
		zh: '中文',
		id: 'Bahasa Indonesia',
		es: 'Español'
	};

	async function onchange(event: Event): Promise<void> {
		const next = (event.currentTarget as HTMLSelectElement).value;
		if (!UI_LOCALES.includes(next as never)) return;
		saving = true;
		errorNote = null;
		try {
			const res = await fetch('/api/settings?target=dsi');
			const body = (await res.json()) as { ok: boolean; text?: string; missing?: boolean };
			if (!body.ok) throw new Error('read failed');
			const doc = body.missing || !body.text ? {} : (parse(body.text) as Record<string, unknown>);
			const ui = (doc.ui && typeof doc.ui === 'object' ? doc.ui : {}) as Record<string, unknown>;
			ui.locale = next;
			doc.ui = ui;
			const { stringify } = await import('yaml');
			const put = await fetch('/api/settings?target=dsi', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: stringify(doc) })
			});
			if (!put.ok) throw new Error('save failed');
			// immediate chrome flip; yaml is the durable operator default
			await setLocale(next as (typeof UI_LOCALES)[number]);
		} catch {
			errorNote = t(m.languageMenu_label) + ': save failed';
		} finally {
			saving = false;
		}
	}
</script>

{#if true}
	<div class="flex items-center gap-2 text-sm" data-testid="locale-settings-row">
		<label class="text-[var(--color-text-secondary)]" for="locale-select">{t(m.languageMenu_label)}</label>
		<select
			id="locale-select"
			class="rounded border border-[var(--color-surface-border)] bg-[var(--color-surface-elevated)] px-2 py-1 text-[var(--color-text-primary)]"
			data-testid="locale-select"
			{onchange}
			disabled={saving}
		>
			{#each UI_LOCALES as loc (loc)}
				<option value={loc} selected={currentLocale() === loc}>{NATIVE_NAMES[loc]}</option>
			{/each}
		</select>
		{#if saving}
			<span class="text-xs text-neutral-400" data-testid="locale-saving">…</span>
		{/if}
		{#if errorNote}
			<span class="text-xs text-red-400" data-testid="locale-error">{errorNote}</span>
		{/if}
	</div>
{/if}
