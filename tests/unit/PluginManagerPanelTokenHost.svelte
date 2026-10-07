<script lang="ts">
	import PluginManagerPanel from '$lib/components/settings-plugins/PluginManagerPanel.svelte';
	// Host for the refreshToken contract (BUG 2026-10-05): the floor bumps
	// the token after a server-side rebuild and the open rack re-fetches.
	let refreshToken = $state(0);
</script>

<button type="button" data-testid="host-bump-token" onclick={() => refreshToken++}>bump</button>
<PluginManagerPanel {refreshToken} />
