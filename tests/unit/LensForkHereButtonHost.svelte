<script lang="ts">
	/**
	 * LensForkHereButtonHost — test fixture: the PanelLoupe provider
	 * shape around a turn-level fork-here button (The Panel Loupe ADR
	 * D8, 2026-09-04) — sets the lens flag at init, then renders
	 * ForkHereButton so it initializes inside a lens tree.
	 */
	import { setLensMode } from '$lib/services/conversation/lens-context.svelte';
	import ForkHereButton from '$lib/components/common/buttons/ForkHereButton.svelte';

	let {
		lens = true,
		sessionId,
		atSeq,
		title = null,
		agentPreset = null
	}: {
		/** Lens flag — true mirrors PanelLoupe; false is the control arm. */
		lens?: boolean;
		sessionId: string;
		atSeq: number;
		title?: string | null;
		agentPreset?: string | null;
	} = $props();

	// Intentional initial capture: context exists only during component
	// initialisation — the fixture mirrors PanelLoupe, which sets the
	// flag once at init before rendering children.
	// svelte-ignore state_referenced_locally
	setLensMode(lens);
</script>

<ForkHereButton {sessionId} {atSeq} {title} {agentPreset} />
