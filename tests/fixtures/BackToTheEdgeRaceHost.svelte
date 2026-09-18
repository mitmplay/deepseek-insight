<!--
	Test fixture (2026-08-24): reproduces the panel-close race that crashed
	BackToTheEdgeButton — a bind:this'd scroll container inside an {#if} block
	that unmounts WHILE BackToTheEdgeButton (inside the same subtree) owns a
	scroll listener on it. Svelte assigns null to the binding before the
	button's $effect teardown runs; the teardown must detach from the
	CAPTURED element, not re-read the nulled prop. Not shipped code.
-->
<script lang="ts">
	import BackToTheEdgeButton from '$lib/components/common/buttons/BackToTheEdgeButton.svelte';

	let show = $state(true);
	let el: HTMLElement | undefined = $state(undefined);

	/** Test hook: unmount the subtree the way a panel close does. */
	export function hide(): void {
		show = false;
	}

	/** Test hook: the live scroll element (null once hidden). */
	export function containerEl(): HTMLElement | null {
		return el ?? null;
	}
</script>

{#if show}
	<div bind:this={el}>
		<BackToTheEdgeButton container={el} threshold={10} />
	</div>
{/if}
