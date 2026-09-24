<script lang="ts">
	import { onMount } from 'svelte';
	import TerminalPanel from './TerminalPanel.svelte';
	import TerminalTabHeader from './TerminalTabHeader.svelte';
	import TerminalTabButton from './TerminalTabButton.svelte';
	import TerminalTabContainer from './TerminalTabContainer.svelte';
	import TerminalSplitContainer from './TerminalSplitContainer.svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { TerminalDeskMirror } from '$lib/types';

	/** TerminalDesk — the ONE terminal floor slot (Terminal Desk ADR,
	 *  2026-09-24, D1/D3): tabs of stacked rows over the server's N-session
	 *  registry. The floor counts desks (always at most one); this
	 *  component owns the tab/row tree, selection, the close cascades (D5),
	 *  and the reload survival pair (D3): the blob MIRROR rides out via
	 *  onMirror; the probe's live session list adjudicates the REBUILD —
	 *  remembered ids that are gone or exited drop, survivors re-attach
	 *  (byte-0 replay per the Surviving Shell's amended D3), and an
	 *  all-dead desk falls back to one fresh self-open row. Row sessions
	 *  the desk mints itself are handed to the panel (row mode); the FIRST
	 *  row of a virgin desk self-opens via the panel's own ladder, so a
	 *  bare command behaves byte-identically to the pre-desk panel. */
	type Row = {
		key: number;
		/** Null = self-open (the panel runs its own ladder and reports back
		 *  via onAssigned); set = the desk holds this session's lease. */
		assigned: { sessionId: string; token: string } | null;
	};
	type Tab = { key: number; rows: Row[] };

	let {
		onShellExit,
		restored = null,
		onMirror
	}: {
		onShellExit?: () => void;
		/** The clamped blob mirror (from the terminal panel entry) — the
		 *  rebuild ladder's REMEMBERED half; the probe is the authority. */
		restored?: TerminalDeskMirror | null;
		/** Fires whenever the tree settles, with the mirror to persist. */
		onMirror?: (mirror: TerminalDeskMirror) => void;
	} = $props();

	let nextKey = 1;
	const mkKey = (): number => nextKey++;

	const defaultTab = (): Tab => ({ key: mkKey(), rows: [{ key: mkKey(), assigned: null }] });

	// A restored desk starts EMPTY (the rebuild ladder fills it); a virgin
	// desk starts with the classic one self-open row. Until the ladder
	// settles, no mirror publishes and no row self-opens. The restored prop
	// is read ONCE here, by design — rebuild state lives in restoring/tabs.
	// svelte-ignore state_referenced_locally
	let restoring = $state(!!restored && restored.tabs.length > 0);
	// svelte-ignore state_referenced_locally
	let tabs = $state<Tab[]>(restoring ? [] : [defaultTab()]);
	let selectedTab = $state(0);
	let opening = $state(false);
	let capped = $state(false);

	$effect(() => {
		if (restoring || tabs.length === 0) return;
		onMirror?.({
			tabs: tabs.map((t) => ({ sessionIds: t.rows.map((r) => r.assigned?.sessionId ?? '').filter((id) => id !== '') })),
			selectedTab
		});
	});

	/** Mint a fresh session server-side and hand it to a new row (row
	 *  mode). A new tab or split-down NEVER re-attaches an existing
	 *  session — the reattach ladder is reload-recovery, not a spawner. */
	async function mintSession(): Promise<Row | null> {
		opening = true;
		try {
			const res = await fetch('/api/terminal', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}'
			});
			if (!res.ok) {
				// MAX_SESSIONS (ADR D6): the server refused — the desk renders
				// the refusal; it can never lift its own cap.
				if ((await res.json().catch(() => ({})))?.error === 'MAX_SESSIONS') capped = true;
				return null;
			}
			const body = (await res.json()) as { sessionId: string; token: string };
			return { key: mkKey(), assigned: { sessionId: body.sessionId, token: body.token } };
		} finally {
			opening = false;
		}
	}

	/** The floor's forwarded command action (ADR D2): --new-tab appends a
	 *  tab and selects it; --split-down stacks a row on the SELECTED tab.
	 *  Both open a fresh session (never re-attach). */
	export function applyAction(action: 'new-tab' | 'split-down'): void {
		void (async () => {
			const row = await mintSession();
			if (!row) return;
			if (action === 'new-tab') {
				tabs.push({ key: mkKey(), rows: [row] });
				selectedTab = tabs.length - 1;
			} else {
				tabs[selectedTab].rows.push(row);
			}
		})();
	}

	/** Tab close (D5): ladder-close every row's session, remove the tab,
	 *  move selection to the right neighbor (or left if last); the last
	 *  tab's close removes the desk slot via onShellExit (the floor's
	 *  removePanel path — the same mutation as the column close). */
	function closeTab(tabIndex: number): void {
		const tab = tabs[tabIndex];
		for (const row of tab.rows) {
			if (row.assigned) {
				void fetch('/api/terminal/' + row.assigned.sessionId + '/send', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ token: row.assigned.token, action: 'close' }),
					keepalive: true
				}).catch(() => undefined);
			}
		}
		tabs.splice(tabIndex, 1);
		if (tabs.length === 0) {
			onShellExit?.();
			return;
		}
		selectedTab = Math.min(tabIndex, tabs.length - 1);
	}

	/** Shell exit in a row (D5): the session is already dead — shrink the
	 *  tab; an empty tab closes (selection rules as closeTab); the desk's
	 *  last shell dying removes the slot (if only one terminal overall, it
	 *  means closing the PanelColumn). */
	function removeRow(tabIndex: number, row: Row): void {
		const tab = tabs[tabIndex];
		const i = tab.rows.indexOf(row);
		if (i >= 0) tab.rows.splice(i, 1);
		if (tab.rows.length === 0) closeTab(tabIndex);
	}

	function recordAssigned(row: Row, sessionId: string, token: string): void {
		// The row self-opened through the panel's ladder — remember the
		// lease so a later tab close can kill it and the mirror persists it.
		row.assigned = { sessionId, token };
	}

	onMount(() => {
		if (!restoring) return;
		// The REBUILD ladder (ADR D3): probe the registry's live sessions,
		// keep the remembered grouping that still matches reality, re-attach
		// each survivor (byte-0 ring replay — the fresh surface needs the
		// scrollback), drop the dead. All dead (or nothing survives the
		// match) ⇒ one fresh self-open row — never a dead frame.
		void (async () => {
			const built: Tab[] = [];
			try {
				const probe = await fetch('/api/terminal');
				const body = (await probe.json()) as {
					enabled: boolean;
					sessions?: Array<{ id: string; exited: boolean }>;
				};
				const live = new Set((body.sessions ?? []).filter((s) => !s.exited).map((s) => s.id));
				for (const remember of restored?.tabs ?? []) {
					const rows: Row[] = [];
					for (const sessionId of remember.sessionIds) {
						if (!live.has(sessionId)) continue; // gone or exited — drop
						const res = await fetch('/api/terminal/' + sessionId + '/reattach', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: '{}'
						});
						if (!res.ok) continue;
						const re = (await res.json()) as { token: string };
						rows.push({ key: mkKey(), assigned: { sessionId, token: re.token } });
					}
					if (rows.length > 0) built.push({ key: mkKey(), rows });
				}
			} catch {
				// the probe failing degrades to the fresh-desk fallback below
			}
			if (built.length === 0) {
				tabs = [defaultTab()];
				selectedTab = 0;
			} else {
				tabs = built;
				selectedTab = Math.max(0, Math.min(built.length - 1, restored?.selectedTab ?? 0));
			}
			restoring = false;
		})();
	});
</script>

<!--
TerminalDesk — tabs and rows inside the ONE terminal floor slot
(Terminal Desk ADR D1/D3, Wave 2–3). Header of tab buttons; one
container per tab (hidden tabs keep streaming); a split container stacks
the rows. Restoring shows a quiet placeholder until the ladder settles.
-->

<div class="flex h-full min-h-0 flex-col rounded-lg bg-slate-900" data-testid="terminal-desk">
	{#if restoring}
		<div class="p-3 text-xs text-slate-500" data-testid="terminal-desk-restoring">...</div>
	{:else}
		<TerminalTabHeader>
			{#each tabs as tab, i (tab.key)}
				<TerminalTabButton
					index={i}
					label={'T' + (i + 1)}
					selected={i === selectedTab}
					onSelect={() => (selectedTab = i)}
					onClose={() => closeTab(i)}
				/>
			{/each}
		</TerminalTabHeader>
		{#each tabs as tab, i (tab.key)}
			<TerminalTabContainer index={i} visible={i === selectedTab}>
				<TerminalSplitContainer rowCount={tab.rows.length}>
					{#each tab.rows as row (row.key)}
						<div class="min-h-0" style="flex: 1 1 0; min-height: 10rem;">
							<TerminalPanel
								assigned={row.assigned}
								onAssigned={(sessionId, token) => recordAssigned(row, sessionId, token)}
								onShellExit={() => removeRow(i, row)}
							/>
						</div>
					{/each}
				</TerminalSplitContainer>
			</TerminalTabContainer>
		{/each}
		{#if opening}
			<div class="p-2 text-[10px] text-slate-500" data-testid="terminal-desk-opening">...</div>
		{/if}
		{#if capped}
			<div class="p-2 text-[10px] text-slate-500" data-testid="terminal-desk-capped">{t(m.terminalSessionCap)}</div>
		{/if}
	{/if}
</div>
