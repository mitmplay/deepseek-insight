<script lang="ts">
	/**
	 * PromptManagerAddHost — test fixture: mounts PromptManagerAdd with a
	 * reactive props object so the $bindable round-trip (text/label/tags
	 * reflecting back into the parent) is observable from the unit test.
	 */
	import PromptManagerAdd from '$lib/components/prompt-manager/PromptManagerAdd.svelte';

	let {
		onsave,
		oncancel,
		portal = false
	}: {
		onsave: () => void;
		oncancel: () => void;
		portal?: boolean;
	} = $props();

	let uses = $state('1');
	let macro = $state(false);
	let text = $state('');
	let label = $state('');
	let tags = $state('');

	// Expose the bound values for assertions via a data attribute read.
</script>

<PromptManagerAdd bind:uses bind:macro bind:text bind:label bind:tags {portal} {onsave} {oncancel} />
<div data-testid="mirror" data-uses={uses} data-macro={macro ? '1' : '0'} data-text={text} data-label={label} data-tags={tags}></div>
