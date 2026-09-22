<script lang="ts">
	import SettingsSkillsPanel from '$lib/components/settings-skills/SettingsSkillsPanel.svelte';
	// The shelf takes no onclose (2026-09-21): PanelColumn's chrome owns
	// close — the host renders the bare panel.
</script>

<SettingsSkillsPanel />
