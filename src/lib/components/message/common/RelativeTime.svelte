<!--
	RelativeTime — one message timestamp: compact relative text
	("just now" → "5m ago" → date) with the exact ISO instant as the
	hover title (extracted from PromptBubble, 2026-08-22).

	Live tick (2026-08-23): the label derives from a component-owned
	wall clock that advances every 10s, so stamps never go stale while
	the page is open (a "5m ago" becomes "6m ago" on its own). The
	interval lives in an $effect — unmount clears it.

	Styling and placement stay host-owned: pass position/size/color
	classes via class (e.g. PromptBubble's absolute bottom-right corner
	slot vs AssistantTurn's stamp at the bottom-left edge).
	data-testid="message-time" + optional data-role carry the
	transcript's test hooks.
-->
<script lang="ts">
	import { relativeTime } from '$lib/utils/time';

	let {
		time,
		role,
		prefix = undefined,
		class: className = ''
	}: {
		/** Wire: entry time (ms epoch). */
		time: number;
		/** Transcript side — rendered as the data-role test hook. */
		role?: string;
		/** Text rendered BEFORE the relative label (AssistantTurn's "Ran
		 *  for 2m 08s" turn wall time); undefined keeps the bare stamp. */
		prefix?: string;
		/** Host positioning + size/color classes. */
		class?: string;
	} = $props();

	/** Component-owned wall clock — advanced by the tick, read by the label. */
	let now = $state(Date.now());

	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 10_000);
		return () => clearInterval(timer);
	});

	const label = $derived(relativeTime(time, now));
</script>

<span
	class={className}
	data-testid="message-time"
	data-role={role}
	title={new Date(time).toISOString()}
>
	{prefix}{prefix !== undefined ? ' · ' : ''}{label}
</span>
