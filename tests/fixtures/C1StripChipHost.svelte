<script lang="ts">
	/**
	 * C1StripChipHost — test fixture (c1-strip-chip.test.ts): wraps
	 * StripChip with $state-backed menuOpen and exported callback logs,
	 * so a test can drive the real open→close cycle (the host flips
	 * menuOpen the way SuggestStrip does) instead of re-mounting per
	 * state. `inStrip` controls whether the chip sits inside a
	 * .suggest-strip ancestor (the ⋯ menu's alignment anchor).
	 */
	import StripChip from '../../src/lib/components/composer/menu/suggest-strip/StripChip.svelte';
	import type { SuggestedPrompt } from '../../src/lib/services/chat/prompt-trigger.js';

	let {
		row,
		active = false,
		query = '',
		mode = 'find',
		hasStep = false,
		hasClose = true,
		inStrip = true
	}: {
		row: SuggestedPrompt;
		active?: boolean;
		query?: string;
		mode?: 'find' | 'run';
		hasStep?: boolean;
		hasClose?: boolean;
		inStrip?: boolean;
	} = $props();

	let menuOpen = $state(false);

	const picks: number[] = [];
	const renames: Array<{ row: SuggestedPrompt; fields: { uses: string; label: string; text: string } }> = [];
	const deletes: SuggestedPrompt[] = [];
	const closes: number[] = [];
	const steps: number[] = [];
	const menuOpens: number[] = [];
	const menuCloses: number[] = [];

	export function picksLog(): number[] {
		return picks;
	}
	export function renamesLog(): typeof renames {
		return renames;
	}
	export function deletesLog(): SuggestedPrompt[] {
		return deletes;
	}
	export function closesLog(): number[] {
		return closes;
	}
	export function stepsLog(): number[] {
		return steps;
	}
	export function menuOpensLog(): number[] {
		return menuOpens;
	}
	export function menuClosesLog(): number[] {
		return menuCloses;
	}
</script>

<div class={inStrip ? 'suggest-strip' : ''}>
	<StripChip
		{row}
		{active}
		{query}
		{mode}
		{menuOpen}
		anyMenuOpen={false}
		onpick={() => picks.push(row.id)}
		onstep={hasStep ? () => steps.push(1) : undefined}
		onrename={(r, fields) => renames.push({ row: r, fields })}
		ondelete={(r) => deletes.push(r)}
		onclose={hasClose ? () => closes.push(1) : undefined}
		onmenuopen={(id) => {
			menuOpens.push(id);
			menuOpen = true;
		}}
		onmenuclose={() => {
			menuCloses.push(1);
			menuOpen = false;
		}}
	/>
</div>
