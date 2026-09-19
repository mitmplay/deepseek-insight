<script lang="ts">
	import PromptsManagerDialog from '$lib/components/prompt-manager/PromptsManagerDialog.svelte';

	const events = $state<string[]>([]);
</script>

<PromptsManagerDialog
	onclose={() => events.push('close')}
	onchanged={() => events.push('changed')}
/>

<input id="event-log" type="hidden" value={events.join(',')} />
