<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	// Three Tongues W3 (ADR 2026-09-12): copy lives in the catalogs.
	import * as m from '$lib/paraglide/messages';
</script>

<div class="empty-floor" data-testid="workspace-empty">
	<p>{t(m.noConversations)}</p>
	<p class="hint">{t(m.pickSession)}</p>
</div>

<style>
	/* Overlays the whole floor (.floor is the positioning context): the
	   zoom row is width: max-content, so a flow child there cannot span
	   the workspace. pointer-events pass through to the rail beneath. */
	.empty-floor {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		text-align: center;
		pointer-events: none;
		color: var(--color-text-secondary, #6c757d);
		font-size: 0.875rem;
	}

	.empty-floor .hint {
		font-size: 0.75rem;
		opacity: 0.8;
	}
</style>
