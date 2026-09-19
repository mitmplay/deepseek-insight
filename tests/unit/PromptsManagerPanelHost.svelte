<script lang="ts">
	import PromptManagerPanel from '$lib/components/prompt-manager/PromptManagerPanel.svelte';

	let {
		escapeScope = 'window' as 'window' | 'root',
		host = 'modal' as 'modal' | 'panel'
	} = $props();

	const events = $state<string[]>([]);
</script>

<PromptManagerPanel
	onclose={() => events.push('close')}
	onchanged={() => events.push('changed')}
	{escapeScope}
	{host}
/>

<input id="event-log" type="hidden" value={events.join(',')} />
