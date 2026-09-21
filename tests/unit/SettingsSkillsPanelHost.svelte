<script lang="ts">
	import SettingsSkillsPanel from '$lib/components/panels/SettingsSkillsPanel.svelte';
	let { onclose }: { onclose: () => void } = $props();
</script>

<SettingsSkillsPanel {onclose} />
