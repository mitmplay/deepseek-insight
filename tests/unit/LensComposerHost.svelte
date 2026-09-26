<script lang="ts">
	/**
	 * LensComposerHost — test fixture: the PanelLoupe provider shape
	 * around a panel composer (The Panel Loupe ADR D8, 2026-09-04) —
	 * sets the lens flag at init, then renders Composer so the
	 * composer initializes inside a lens tree. The props subset mirrors
	 * prompt-input-sync.test.ts's mountInput harness.
	 */
	import { setLensMode } from '$lib/services/conversation/lens-context.svelte';
	import Composer from '$lib/components/composer/Composer.svelte';

	let {
		lens = true,
		sessionId,
		onsubmit = async () => true,
		oncancel = () => {},
		isStreaming = false,
		sending = false
	}: {
		/** Lens flag — true mirrors PanelLoupe; false is the control arm. */
		lens?: boolean;
		sessionId?: string;
		onsubmit?: (text: string) => boolean | Promise<boolean>;
		oncancel?: () => void;
		isStreaming?: boolean;
		sending?: boolean;
	} = $props();

	// Intentional initial capture: context exists only during component
	// initialisation — the fixture mirrors PanelLoupe, which sets the
	// flag once at init before rendering children.
	// svelte-ignore state_referenced_locally
	setLensMode(lens);
</script>

<Composer {sessionId} {onsubmit} {oncancel} {isStreaming} {sending} />
