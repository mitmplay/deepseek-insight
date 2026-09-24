<script lang="ts">
	/**
	 * ChipPopupHost — test fixture: binds the popup's `scroller` out so a
	 * test can assert the scroll box actually lands in the host's state
	 * (the stick-to-bottom attach point).
	 */
	import ChipPopup from '$lib/components/message/assistant/ChipPopup.svelte';
	let scroller: HTMLElement | null = $state(null);
</script>

<ChipPopup bind:scroller>
	<p data-testid="chip-popup-content">popup body</p>
</ChipPopup>
<p data-testid="chip-popup-bound">{scroller === null ? 'unbound' : 'bound'}</p>
