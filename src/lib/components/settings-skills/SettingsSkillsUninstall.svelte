<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	/**
	 * SettingsSkillsUninstall — the uninstall verb of a shelf skill card
	 * (extracted from SettingsSkillsItem): rendered only when the card is
	 * uninstallable (uninstall tab); disabled while a call is in flight.
	 */
	let {
		/** The skill card's id — the verb's testid key. */
		id,
		/** Disables the verb while a call is in flight. */
		busy = false,
		/** Uninstall intent for this skill id. */
		onuninstall
	}: {
		id: string;
		busy?: boolean;
		onuninstall?: () => void;
	} = $props();
</script>

<button type="button" class="shelf-uninstall" data-testid={'shelf-uninstall-' + id} onclick={() => onuninstall?.()} disabled={busy}>{t(m.skillsShelfUninstall)}</button>

<style>
	.shelf-uninstall {
		font-size: 0.7rem;
	}
</style>
