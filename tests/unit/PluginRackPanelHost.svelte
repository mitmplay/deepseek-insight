<script lang="ts">
	import PluginManagerPanel from '$lib/components/settings-plugins/PluginManagerPanel.svelte';
	// The rack takes no onclose (mirrors the shelf, 2026-09-21):
	// PanelColumn's chrome owns close — the host renders the bare panel.
</script>

<PluginManagerPanel />
