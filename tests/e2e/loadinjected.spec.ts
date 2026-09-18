/**
 * E2E: DSI Loadinjected — Wave 5 task 5.1 (2026-09-07, ADR "The
 * Loadinjected Command" D1–D6). The shelf + command journeys against the
 * stub DSH host: the deterministic session already seeds the
 * request/header epoch (seq 99, STUB_SYSTEM_PROMPT — the synthetic shelf
 * member), and beforeAll splices two instructions envelopes into the
 * ledger with the fixture-pinned agent-instructions source whose
 * changes[].path is the shelf's structural identity (AGENTS.md prose for
 * the markdown surface, config.yaml for Monaco).
 *
 *   Injected button → popup lists system-prompt.md first, then AGENTS.md
 *   → clicking AGENTS.md opens a markdown panel in the slot DIRECTLY
 *   BELOW the source conversation (the D3 fork-child slot; the sidebar
 *   row paints maroon at depth 1) → clicking the same item again moves
 *   FOCUS (the doc row becomes current) and adds NOTHING (D5) →
 *   config.yaml opens the Monaco readOnly surface, system-prompt.md the
 *   D7-titled epoch panel (the extension routing, D1) → the command
 *   path's honest notes (usage, no-match with candidates).
 *
 * Selectors verified in component source (Step 3.8): injected-shelf-button
 * / injected-shelf-popup / injected-shelf-item + data-display-path
 * (InjectedShelfButton) / injected-doc-panel + data-display-path +
 * doc-title + doc-editor-host + injected-doc-missing (InjectedDocPanel) /
 * markdown-panel (MarkdownPanel) / panel-column + data-session-id
 * (PanelColumn) / sidebar-panel-group-toggle + sidebar-panel-row +
 * data-depth + sidebar-session-current (SidebarOpenPanels(group) +
 * SidebarOpenPanelRows) / prompt-textarea / command-note.
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID, STUB_SYSTEM_PROMPT, type StubLedgerEntry } from './dsh-stub';

const STUB_PORT = 4590;

/** The markdown envelope's body carries a heading marker the panel renders. */
const AGENTS_BODY = '# Workspace Rules\n\nBe kind to the tools.';
const CONFIG_BODY = 'shell:\n  maxRows: 42\n';

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
	// The two instructions envelopes are spliced INTO the stub's ledger at
	// in-tail seqs (97/98, below the seq-99 header — the array stays
	// seq-ascending and maxSeq stays 111). pushEventFor would bump lastSeq
	// above the tail and leave the SHARED preview server's session cursor
	// drifted past the NEXT spec file's fresh stub (lastSeq 111) — an empty
	// poisoned seed for that file (manager-panel W4-4.2-T, adjudicated
	// 2026-09-07 by stash baseline). Direct ledger mutation before any page
	// loads has no cross-file footprint. The newest envelope naming a path
	// wins at resolution (D7).
	const injection = (
		seq: number,
		path: string,
		digest: string,
		text: string,
		baseline = true
	): StubLedgerEntry => ({
		event: {
			type: 'user/message',
			seq,
			time: Date.now(),
			data: {
				id: `e2e-instructions-${seq}`,
				source: {
					kind: 'agent-instructions',
					form: 'instructions',
					baseline,
					changes: [{ action: 'set', scope: `.\u0000${path}`, path, digest }]
				},
				content: [{ type: 'text', text }]
			}
		}
	});
	stub.state.ledger.unshift(
		// unshift(a, b) lands [a, b] — AGENTS.md (97) must precede
		// config.yaml (98) for the first-injection order (D6).
		injection(
			97,
			'AGENTS.md',
			'ff4b48bfff997c2145f119d02d3f913abdfc5134',
			'<system-reminder>\nInstructions from: AGENTS.md\n\n' + AGENTS_BODY + '\n</system-reminder>'
		),
		injection(
			98,
			'config.yaml',
			'dd11',
			'Instructions from: config.yaml\n\n' + CONFIG_BODY,
			false // a LATER per-scope envelope — below the first-load divider
		)
	);
});

test.afterAll(async () => {
	await stub?.stop();
});

/** Open the shelf popup and click one member by its display path. */
async function pickShelfItem(page: import('@playwright/test').Page, displayPath: string): Promise<void> {
	await page.getByTestId('injected-shelf-button').click();
	await expect(page.getByTestId('injected-shelf-popup')).toBeVisible();
	await page
		.locator(`[data-testid="injected-shelf-item"][data-display-path="${displayPath}"]`)
		.getByTestId('injected-shelf-pick')
		.click();
	await expect(page.getByTestId('injected-shelf-popup')).toHaveCount(0);
}

test('01 · the shelf lists the conversation\'s documents in order; AGENTS.md opens a markdown panel below the source with a maroon depth-1 sidebar row', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	// The pinned-panel group ships EXPANDED (2026-09-18) — ensure it is open before row reads.
	{
		const t = page.getByTestId('sidebar-panel-group-toggle');
		if ((await t.getAttribute('aria-expanded')) === 'false') await t.click();
	}
	await expect(page.getByTestId('sidebar-panel-group-toggle')).toHaveAttribute('aria-expanded', 'true');

	const shelfBtn = page.getByTestId('injected-shelf-button');
	await expect(shelfBtn).toBeVisible(); // non-empty shelf — the gate rides with the button
	await shelfBtn.click();
	const items = page.getByTestId('injected-shelf-item');
	// The operator's order (D6): system-prompt first, then instructions by
	// first injection — AGENTS.md (seq 97) before config.yaml (seq 98).
	await expect(items).toHaveCount(3);
	await expect(items.nth(0)).toHaveAttribute('data-display-path', 'system-prompt.md');
	await expect(items.nth(1)).toHaveAttribute('data-display-path', 'AGENTS.md');
	await expect(items.nth(2)).toHaveAttribute('data-display-path', 'config.yaml');
	// The origin boundary (D6/D7): an <hr> between the synthetic member and
	// the injected files — the operator sees WHICH load is a different kind.
	// The FIRST-LOAD boundary: an <hr> between the baseline members
	// (system prompt + baseline AGENTS.md) and the LATER config.yaml
	// injection — the operator sees which load arrived when.
	await expect(page.getByTestId('shelf-first-load-divider')).toHaveCount(1);
	await items.nth(1).click();

	// The markdown surface over the LOGGED payload (D1) — the transcript's
	// own renderer, not a live-file read.
	const doc = page.locator('[data-testid="injected-doc-panel"][data-display-path="AGENTS.md"]');
	await expect(doc).toHaveCount(1);
	await expect(doc.getByTestId('markdown-panel')).toContainText('Workspace Rules');
	// PROVENANCE (D1 made visible): the toolbar cites the ledger position of
	// the envelope the payload came from — the operator can verify origin.
	await expect(doc.getByTestId('injected-doc-state')).toContainText('seq 97');

	// BELOW the source (D3): floor order — the doc column directly follows
	// the conversation column (array order = the columns' DOM order).
	const order = await page
		.locator('[data-testid="panel-column"]')
		.evaluateAll((els) => els.map((e) => e.getAttribute('data-session-id')));
	expect(order).toEqual([STUB_SESSION_ID, null]);
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	// The sidebar row: a depth-1 child painting MAROON #800000 (D3). The
	// insert SELECTED the newcomer, so the row carries the current testid —
	// locate by the stable data-panel-id + data-depth pair.
	const row = page.locator('[data-panel-id][data-depth="1"]');
	await expect(row).toHaveCount(1);
	await expect(row).toHaveAttribute('data-testid', 'sidebar-session-current');
	await expect(row).toContainText('AGENTS.md');
	// D3 names the SURFACE — the branch tree line (the fork-green line's
	// home in WorkspaceRowItem) paints MAROON for a document child
	// (correction, RCA 2026-09-07). The text keeps its ordinary colors.
	const lineColor = await row
		.first()
		.locator('.tree-line')
		.evaluate((el) => getComputedStyle(el).color);
	expect(lineColor).toBe('rgb(128, 0, 0)');
});

test('02 · clicking the same member again moves FOCUS to the open panel and adds NOTHING (D5)', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();
	{
		const t = page.getByTestId('sidebar-panel-group-toggle');
		if ((await t.getAttribute('aria-expanded')) === 'false') await t.click();
	}
	await expect(page.getByTestId('sidebar-panel-group-toggle')).toHaveAttribute('aria-expanded', 'true');

	await pickShelfItem(page, 'AGENTS.md');
	await expect(page.locator('[data-testid="injected-doc-panel"][data-display-path="AGENTS.md"]')).toHaveCount(1);

	// Give the conversation the selection back — via its SIDEBAR row (the
	// column header owns its own pointer handling, so a column click is not
	// a reliable select) — then the second load must move focus FORWARD to
	// the doc panel.
	const convRow = page.locator(
		`[data-testid="sidebar-panel-row"][data-session-id="${STUB_SESSION_ID}"]`
	);
	await convRow.click();
	// The doc row lost the current marker (plain row again, still depth 1).
	await expect(page.locator('[data-testid="sidebar-panel-row"][data-depth="1"]')).toHaveCount(1);

	await pickShelfItem(page, 'AGENTS.md');

	// No duplicate, no new column — the load was PREVENTED (D5).
	await expect(page.locator('[data-testid="injected-doc-panel"][data-display-path="AGENTS.md"]')).toHaveCount(1);
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	// Focus moved: the doc row is the CURRENT row (the full focus change).
	const currentRow = page.locator('[data-testid="sidebar-session-current"]');
	await expect(currentRow).toHaveCount(1);
	await expect(currentRow).toHaveAttribute('data-depth', '1');
	await expect(currentRow).toContainText('AGENTS.md');
});

test('03 · the surface routes by file type: config.yaml opens Monaco readOnly; system-prompt.md opens the D7-titled epoch panel', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	await pickShelfItem(page, 'config.yaml');
	const cfg = page.locator('[data-testid="injected-doc-panel"][data-display-path="config.yaml"]');
	await expect(cfg).toHaveCount(1);
	await expect(cfg).toContainText('read-only — the logged payload');
	await expect(cfg.locator('.doc-editor-host')).toBeVisible();
	// The lazy Monaco chunk paints the buffer (settings-panel spec's 15s budget).
	await expect(cfg).toContainText('maxRows', { timeout: 15_000 });
	await expect(cfg.getByTestId('injected-doc-state')).toContainText('seq 98');

	await pickShelfItem(page, 'system-prompt.md');
	const sp = page.locator('[data-testid="injected-doc-panel"][data-display-path="system-prompt.md"]');
	await expect(sp).toHaveCount(1);
	await expect(sp.locator('.doc-title')).toHaveText('system prompt — latest epoch');
	await expect(sp).toContainText(STUB_SYSTEM_PROMPT);
	// The synthetic member's provenance is the header epoch's ledger position.
	await expect(sp.getByTestId('injected-doc-state')).toContainText('seq 99');
});

test('04 · the command path keeps its honest notes: usage on a missing filename, candidates on a no-match', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	const input = page.getByTestId('prompt-textarea');
	await input.fill('/loadinjected');
	await input.press('Enter');
	await expect(page.getByTestId('command-note')).toContainText('usage: /loadinjected <filename.md> [--add]');

	await input.fill('/loadinjected NOPE.md');
	await input.press('Enter');
	await expect(page.getByTestId('command-note')).toContainText(
		'no injected NOPE.md here — the shelf holds: system-prompt.md, AGENTS.md, config.yaml'
	);
	await expect(page.getByTestId('injected-doc-panel')).toHaveCount(0);
});

test('05 · lineage grammar for ALL child kinds: a move never strands the document child', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();
	{
		const t = page.getByTestId('sidebar-panel-group-toggle');
		if ((await t.getAttribute('aria-expanded')) === 'false') await t.click();
	}

	// The doc child sits directly below its source, and holds the focus
	// (the insert selected it).
	await pickShelfItem(page, 'AGENTS.md');
	await expect(page.locator('[data-testid="injected-doc-panel"][data-display-path="AGENTS.md"]')).toHaveCount(1);

	// Give the source conversation the selection back, then paste two
	// stranger conversations — each lands BEFORE the focused panel, so the
	// floor reads [C, B, source, doc].
	const convRow = page.locator(
		`[data-testid="sidebar-panel-row"][data-session-id="${STUB_SESSION_ID}"]`
	);
	await convRow.click();
	await page.getByTestId('controlbar-trigger').click();
	await page.getByTestId('controlbar-tray').waitFor({ state: 'visible' });
	const tray = page.getByTestId('controlbar-add-input');
	await tray.fill('e2e-blank-session-0002');
	await page.getByTestId('controlbar-add-submit').click();
	await expect(page.getByTestId('panel-column')).toHaveCount(3);
	await tray.fill('e2e-chat-session-0003');
	await page.getByTestId('controlbar-add-submit').click();
	await expect(page.getByTestId('panel-column')).toHaveCount(4);
	// The tray dismisses on Escape (ControlBar's keyboard close) — and it
	// must be CLOSED before the move: an open tray eats the next outside
	// click, including the sidebar's move buttons.
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('controlbar-tray')).toHaveCount(0);
	// The two strangers landed inside the floor; the order reads
	// [chat, blank, source, doc].
	const before = await page
		.locator('[data-testid="panel-column"]')
		.evaluateAll((els) => els.map((e) => e.getAttribute('data-session-id')));
	expect(before).toEqual(['e2e-chat-session-0003', 'e2e-blank-session-0002', STUB_SESSION_ID, null]);

	// Move BLANK down: its below-neighbor is the source's whole family
	// block (source + doc child) — the block leaps WHOLE, so the doc child
	// travels WITH its source (the consolidated grammar: one block math
	// for fork, sub-agent, and injected-doc children).
	await page
		.locator('[data-testid="sidebar-panel-row"][data-session-id="e2e-blank-session-0002"]')
		.getByTestId('sidebar-panel-move-down')
		.click();
	// Poll — the reorder is a Svelte state flush, not an instant DOM swap.
	await expect
		.poll(() =>
			page
				.locator('[data-testid="panel-column"]')
				.evaluateAll((els) => els.map((e) => e.getAttribute('data-session-id')))
		)
		.toEqual(['e2e-chat-session-0003', STUB_SESSION_ID, null, 'e2e-blank-session-0002']);
	// The doc child is STILL directly below its source — never stranded.
	await expect(page.locator('[data-testid="injected-doc-panel"][data-display-path="AGENTS.md"]')).toHaveCount(1);
});
