<script lang="ts">
	/**
	 * AppSidebarHeaderTitle — the expanded rail header's brand title
	 * (extracted from AppSidebar, 2026-09): "Deepseek Insight" with the
	 * sidebar-title testid both branches shared.
	 *
	 * Presentational only — no props; the brand string is i18n-skip.
	 */
</script>

<div class="rail-header-group">
	<!-- i18n-skip: brand -->
	<span class="rail-title" data-testid="sidebar-title">Deepseek Insight</span>
</div>

<style>
	.rail-header-group {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
		/* Align left: the header row is space-between across prefix
		   (AboutButton) / title / action cluster — without this the
		   three-way spread pushed the title to the middle. */
		margin-right: auto;
	}

	.rail-title {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		/* AA on every gradient stop (>= 5.4:1); see the shared gradient rule. */
		color: #4b5563;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
