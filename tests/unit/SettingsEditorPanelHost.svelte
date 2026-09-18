<script lang="ts">
	import SettingsEditorPanel from '$lib/components/panels/SettingsEditorPanel.svelte';

	let {
		target,
		id
	}: {
		target: 'dsi' | 'dsh';
		id: string;
	} = $props();

	const events = $state<string[]>([]);

	function close(): void {
		events.push('close:' + id);
		// host-test parity with the floor: close is the host's concern
		document.getElementById('event-log-' + id)?.setAttribute('value', events.join(','));
	}
</script>

<SettingsEditorPanel {target} onclose={close} />

<input id="event-log-{id}" type="hidden" value={events.join(',')} />
