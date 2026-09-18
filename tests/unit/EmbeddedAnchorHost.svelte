<script lang="ts">
	/**
	 * EmbeddedAnchorHost — unit-test host proving the panel-mode context
	 * seam (2026-08-24 per-panel FloatingAnchor fix): the host calls
	 * setPanelMode(true) exactly as ConversationPanel does on the floor,
	 * then renders a bare FloatingAnchor whose `embedded` prop must
	 * default from context.
	 */
	import FloatingAnchor from '$lib/components/common/containers/FloatingAnchor.svelte';
	import { setPanelMode } from '$lib/services/conversation/panel-context.svelte';
	import { createRawSnippet } from 'svelte';

	setPanelMode(true);
</script>

<FloatingAnchor>
	{@render createRawSnippet(() => ({ render: () => '<button data-testid="leaf">go</button>' }))()}
</FloatingAnchor>
