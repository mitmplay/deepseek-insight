<script lang="ts">
	/**
	 * StickHost — minimal driver for the stick-to-bottom unit tests
	 * (tests/unit/stick-to-bottom.test.ts): a scroll box whose children
	 * and text the tests grow, plus the same attach/$effect wiring the
	 * real consumers (ConversationScrollArea, the think popup) use.
	 * Exposes addChild/growText/reattach/detach, the behavior object,
	 * and the flips log on the mounted instance (ScrollAreaHost pattern).
	 */
	import { createStickToBottom } from '$lib/utils/stick-to-bottom.svelte';

	let {
		children = 2,
		jump = false,
		threshold
	}: { children?: number; jump?: boolean; threshold?: number } = $props();

	const flipLog: boolean[] = [];
	// Intentional initial capture: the behavior object is built ONCE at
	// fixture init, so threshold is a construction constant by design.
	// svelte-ignore state_referenced_locally
	const stickBehavior = createStickToBottom({
		...(threshold !== undefined ? { thresholdPx: threshold } : {}),
		onstickchange: (next) => flipLog.push(next)
	});

	let box = $state<HTMLElement | null>(null);
	// Intentional initial capture: children seeds the child count; tests
	// grow it afterward through addChild().
	// svelte-ignore state_referenced_locally
	let count = $state(children);
	/** Grows INSIDE the last child — a text-node (characterData) mutation
	 *  with no childList change, the streaming-delta shape. */
	let streamText = $state('line');

	$effect(() => {
		if (!box) return;
		return stickBehavior.attachTo(box, { jumpToBottom: jump });
	});

	export function addChild(): void {
		count += 1;
	}
	export function growText(): void {
		streamText += ' more text';
	}
	export function reattach(): void {
		if (box) stickBehavior.attachTo(box);
	}
	export function detach(): void {
		// Swapping the target detaches the box (the cleanup contract).
		stickBehavior.attachTo(document.createElement('div'));
	}
	export const stb = stickBehavior;
	export const flips = flipLog;
</script>

<div bind:this={box} data-testid="stick-box" class="h-[50px] w-[200px] overflow-y-auto">
	{#each Array.from({ length: count }) as _, i (i)}
		<p>child {i}{i === count - 1 ? ` — ${streamText}` : ''}</p>
	{/each}
</div>
