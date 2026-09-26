<script lang="ts">
	/**
	 * SlashMenuHarness — test fixture (slash-menu.test.ts): wraps
	 * SlashMenu with $state-backed props and an exported `set()` — Svelte
	 * 5 mount() instances take prop values at mount only, so tests drive
	 * activeIndex changes through this bridge (no $set in runes mode).
	 *
	 * The catalog prop is re-published under its public name `state`; the
	 * local binding is deliberately NOT named `state` (a local of that
	 * name collides with the $state rune's lowering — see SlashMenu
	 * 2026-09-03).
	 */
	import SlashMenu from '../../src/lib/components/composer/menu/SlashMenu.svelte';
	import type { DsiCommandRow, DsiGestureRow, DsiSkillRow } from '../../src/lib/types';

	let {
		gestures = [],
		commands,
		skills = [],
		catalogState = 'ready',
		query = '/',
		activeIndex = 0
	}: {
		gestures?: readonly DsiGestureRow[];
		commands: readonly DsiCommandRow[];
		skills?: readonly DsiSkillRow[];
		catalogState?: 'idle' | 'loading' | 'ready' | 'failed';
		query?: string;
		activeIndex?: number;
	} = $props();

	// Intentional initial capture: mount-time values seed the bridge state;
	// later changes arrive ONLY through set() (the test's driver).
	// svelte-ignore state_referenced_locally
	let g = $state(gestures);
	// svelte-ignore state_referenced_locally
	let c = $state(commands);
	// svelte-ignore state_referenced_locally
	let s = $state(skills);
	// svelte-ignore state_referenced_locally
	let cs = $state(catalogState);
	// svelte-ignore state_referenced_locally
	let q = $state(query);
	// svelte-ignore state_referenced_locally
	let ai = $state(activeIndex);

	export function set(next: { activeIndex?: number }): void {
		if (next.activeIndex !== undefined) ai = next.activeIndex;
	}
</script>

<SlashMenu
	gestures={g}
	commands={c}
	skills={s}
	state={cs}
	query={q}
	activeIndex={ai}
	onpickgesture={() => {}}
	onpickcommand={() => {}}
	onpickcommandwithhint={() => {}}
	onpickskill={() => {}}
/>
