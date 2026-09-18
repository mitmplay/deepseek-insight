<script lang="ts">
	/** Test-only reactive host: drives SavePromptButton's `text` prop with
	 *  real $state so a test can flip it to whitespace AFTER the popup has
	 *  opened (reaching save()'s empty-text guard). Same pattern as
	 *  PromptManagerAddHost.svelte. */
	import SavePromptButton from '$lib/components/common/buttons/SavePromptButton.svelte';

	let text = $state('load project AIP, OCI');
</script>

<SavePromptButton {text} />
<button type="button" data-testid="host-set-empty" onclick={() => (text = '   ')}>set empty</button>
