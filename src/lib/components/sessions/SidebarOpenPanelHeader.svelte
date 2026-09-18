<script lang="ts">
	/**
	 * SidebarOpenPanelHeader — the pinned-panel group title's
	 * focused-name chip (extracted from SidebarOpenPanels
	 * 2026-09-02): the focused panel's name in the filter row's
	 * summary-chip grammar (border + tint + deepened text) with the
	 * row's own SessionStatus glyph beside it. Purely presentational —
	 * every fact arrives as a prop; `name === null` renders nothing
	 * (the host's title keeps its bare `Focused - ` stem).
	 *
	 * NOT the home of the lineage fold pair (2026-09-03): it renders
	 * beside the group-head BUTTON as its own component —
	 * SidebarOpenPanelTree. This chip renders INSIDE that button,
	 * and a button cannot nest a button.
	 */
	import SessionStatus from './SessionStatus.svelte';

	let {
		name,
		dead = false,
		running = false
	}: {
		/** Focused panel's name (title ?? sessionId) — null renders no chip. */
		name: string | null;
		/** The focused panel's session died on the host — the honest 404 tint. */
		dead?: boolean;
		/** The focused panel is streaming — animated status bars. */
		running?: boolean;
	} = $props();
</script>

{#if name !== null}
	<span
		class="title-chip"
		class:dead={dead}
		data-testid="sidebar-panel-group-chip"
	>
		<SessionStatus running={running} /><span class="chip-label">
			{name}
		</span>
	</span>
{/if}

<style>
	/* Title chip (2026-08-26): the focused panel's name in the. Carries 
	   the row's SessionStatus glyph (the rows' own: animated bars running, dot idle) 
	   so the header tells live/dead at a glance. */
	.title-chip {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.1875rem;
		line-height: 1;
		padding: 0.125rem 0.375rem;
		white-space: nowrap;
	}

	.chip-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Honest 404 tint, the row's own grammar: the focused panel's
	   session died on the host — red-800 text/border; the idle dot
	   follows via the --si-idle custom property (it inherits through
	   the SessionStatus boundary; scoped selectors cannot). */
	.title-chip.dead {
		color: #991b1b;
		border-color: #991b1b;
		background: transparent;
		--si-idle: #991b1b;
	}
</style>
