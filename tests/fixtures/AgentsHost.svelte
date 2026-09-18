<script lang="ts">
	/**
	 * AgentsHost — test fixture for agents-pills.test.ts: wraps the Agents
	 * pill group with $state-backed props and an exported `set()` so tests
	 * can drive prop CHANGES after mount (a plain `mount` pins the initial
	 * values, which never exercises the template's update closures).
	 */
	import Agents from '$lib/components/common/layout/Agents.svelte';
	import type { FilterOption } from '$lib/utils/session-filters';

	let {
		initialPresets,
		initialSelected,
		onpick
	}: {
		initialPresets: FilterOption[];
		initialSelected: string | null;
		onpick: (key: string) => void;
	} = $props();

	// Intentional initial capture: mount-time values seed the bridge
	// state; later changes arrive only through set() (test driver).
	// svelte-ignore state_referenced_locally
	let presets = $state(initialPresets);
	// svelte-ignore state_referenced_locally
	let selected = $state(initialSelected);

	export function set(next: { presets?: FilterOption[]; selected?: string | null }): void {
		if (next.presets !== undefined) presets = next.presets;
		if (next.selected !== undefined) selected = next.selected;
	}
</script>

<Agents {presets} {selected} {onpick} />
