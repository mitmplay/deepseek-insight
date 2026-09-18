/**
 * E2E: the fork button (The Fork Button ADR, 2026-09-01) — same
 * stub-host setup as conversation.spec.ts, no live dsh web needed.
 *
 * Contract under test:
 *   1. the header carries the fork button; clicking forks at the LAST
 *      COMPLETED TURN (the wire record pins atSeq: null — omitted) and
 *      the child JOINS THE FLOOR DIRECTLY BELOW the source panel (the
 *      source keeps its index, the child takes index+1) with the
 *      inherited transcript rendered (the seed IS the transcript)
 *   2. the forked child appears in the sidebar's panel group and takes
 *      the selection (the focused slot's focus)
 *   3. the refusal path is honest: a session with no completed turn
 *      surfaces the host's session/fork-unavailable message verbatim in
 *      the transient chip — nothing opens, the current view stays
 */

import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID, STUB_BLANK_SESSION_ID, STUB_USER_HELLO } from './dsh-stub';

const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

async function openPanelGroup(page: import('@playwright/test').Page): Promise<void> {
	const toggle = page.getByTestId('sidebar-panel-group-toggle');
	// Expanded is the load default (2026-09-18) — click only when folded.
	if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

test('fork: the child joins the floor below its source with the inherited transcript', async ({
	page
}) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await openPanelGroup(page);

	const fork = page.getByTestId('fork-button');
	await expect(fork).toBeVisible();
	await expect(page.getByTestId('panel-column')).toHaveCount(1);

	await fork.click();

	// After-source placement: the SOURCE keeps its index, the child takes
	// the next one — two panels, [source, child], and the child
	// (e2e-forked-0001) is the newly selected one.
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	const columns = page.getByTestId('panel-column');
	await expect(columns.nth(0)).toHaveAttribute('data-session-id', STUB_SESSION_ID);
	await expect(columns.nth(1)).toHaveAttribute('data-session-id', 'e2e-forked-0001');
	const selected = page.getByTestId('sidebar-session-current');
	await expect(selected).toHaveAttribute('data-session-id', 'e2e-forked-0001');

	// The seed IS the transcript: the child panel renders the source's
	// completed turn (the stub copies the source ledger — no re-prompt).
	const childPanel = columns
		.nth(1)
		.locator('[data-testid="message-bubble"][data-role="user"]', { hasText: STUB_USER_HELLO });
	await expect(childPanel).toBeVisible();

	// The sidebar files the child (an open panel row under the parent's group).
	const childRow = page.locator('[data-session-id="e2e-forked-0001"]');
	await expect(childRow.first()).toBeVisible();

	// The wire record: exactly one fork, atSeq omitted (null = absent).
	const state = (await (await fetch(stubCtl)).json()) as {
		forkCalls: Array<{ sessionId: string; atSeq: number | null }>;
	};
	expect(state.forkCalls).toEqual([{ sessionId: STUB_SESSION_ID, atSeq: null }]);
});

test('fork refusal: a turn-less session surfaces the host refusal verbatim — nothing opens', async ({
	page
}) => {
	await page.goto(`/?sessionKey=${STUB_BLANK_SESSION_ID}`);

	const fork = page.getByTestId('fork-button');
	await expect(fork).toBeVisible();
	await expect(page.getByTestId('panel-column')).toHaveCount(1);

	await fork.click();

	// The host's refusal message surfaces verbatim in the transient chip…
	const error = page.getByTestId('fork-error');
	await expect(error).toBeVisible();
	await expect(error).toContainText('no completed turn to fork from');

	// …nothing opens, and the current view is untouched.
	await expect(page.getByTestId('panel-column')).toHaveCount(1);

	// The wire record: the refusal still rode a well-formed fork call.
	// (The stub accumulates across the file's tests — filter to THIS source.)
	const state = (await (await fetch(stubCtl)).json()) as {
		forkCalls: Array<{ sessionId: string; atSeq: number | null }>;
	};
	expect(state.forkCalls.filter((c) => c.sessionId === STUB_BLANK_SESSION_ID)).toEqual([
		{ sessionId: STUB_BLANK_SESSION_ID, atSeq: null }
	]);
});

test('fork-here: clicking the turn fork anchors the cut at THAT turn (atSeq rides the wire)', async ({
	page
}) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);

	// The stub transcript's assistant turn — hover reveals the action row,
	// the fork-here mark arms every turn of a forkable panel. (The panel
	// resolves session state over the wire — give the armed row a generous
	// window before the click.)
	const turn = page.getByTestId('assistant-turn').first();
	await expect(turn).toBeVisible();
	const here = turn.locator('[data-testid="fork-here-button"]');
	await expect(here).toBeAttached({ timeout: 15000 });
	await turn.hover();
	await here.click();

	// After-source placement: [source, child] — the child is focused.
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	// The child id comes from the stub's own record (forkedSessions grows
	// with every fork in this file — never hardcode the ordinal).
	const state = (await (await fetch(stubCtl)).json()) as {
		ledger: Array<{ event?: { type?: string; seq?: number } }>;
		forkCalls: Array<{ sessionId: string; atSeq: number | null }>;
		forkedSessions: Array<{ sessionId: string; parentSessionId: string }>;
	};
	const child = state.forkedSessions.at(-1)?.sessionId;
	expect(child).toBeDefined();
	const columns = page.getByTestId('panel-column');
	await expect(columns.nth(1)).toHaveAttribute('data-session-id', child!);

	// The wire record: THIS fork carried the turn anchor — the stub
	// ledger's first assistant-side row seq (the turn's identity).
	const expectedAnchor = state.ledger.find((r) => r.event?.type?.startsWith('assistant/'))?.event
		?.seq;
	expect(expectedAnchor).toBeDefined();
	expect(state.forkCalls.at(-1)).toEqual({
		sessionId: STUB_SESSION_ID,
		atSeq: expectedAnchor
	});
});

test('lineage fold pair: a forked family flips the header seg-group disable states', async ({
	page
}) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await openPanelGroup(page);

	// No family on the floor yet — the pair renders, both die (the
	// vacuous extremes: everything collapsed AND everything unfolded).
	const collapseAll = page.getByTestId('sidebar-lineage-collapse-all');
	const expandAll = page.getByTestId('sidebar-lineage-expand-all');
	await expect(collapseAll).toBeDisabled();
	await expect(expandAll).toBeDisabled();

	// Fork: the child joins the floor below the source; the fold-on-add
	// reveal leaves the family OPEN — expand dies, collapse arms.
	await page.getByTestId('fork-button').click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	const state = (await (await fetch(stubCtl)).json()) as {
		forkedSessions: Array<{ sessionId: string; parentSessionId: string }>;
	};
	const child = state.forkedSessions.at(-1)?.sessionId;
	expect(child).toBeDefined();
	const rowsBody = page.getByTestId('sidebar-panel-rows-scroll');
	const childRow = rowsBody.locator(`[data-session-id="${child}"]`);
	await expect(childRow).toBeVisible();
	await expect(expandAll).toBeDisabled();
	await expect(collapseAll).toBeEnabled();

	// Collapse-all folds the family: the child row leaves the group (the
	// panel column itself is untouched — the fold is sidebar visibility),
	// and the source row's own chevron reads closed.
	await collapseAll.click();
	await expect(childRow).toHaveCount(0);
	await expect(
		rowsBody
			.locator(`[data-testid="sidebar-panel-row"][data-session-id="${STUB_SESSION_ID}"]`)
			.locator('[data-testid="sidebar-panel-fold"]')
	).toHaveAttribute('aria-expanded', 'false');
	await expect(collapseAll).toBeDisabled();
	await expect(expandAll).toBeEnabled();

	// Expand-all brings the family back — expand dies at its extreme.
	await expandAll.click();
	await expect(childRow).toBeVisible();
	await expect(expandAll).toBeDisabled();
	await expect(collapseAll).toBeEnabled();

	// A COLLAPSED group arms both segments again — no rows visible, the
	// unfold extreme gates nothing. Collapsing the group hides the rows
	// (the fold state itself is untouched).
	await page.getByTestId('sidebar-panel-group-toggle').click();
	await expect(page.getByTestId('sidebar-panel-group-toggle')).toHaveAttribute(
		'aria-expanded',
		'false'
	);
	await expect(childRow).toHaveCount(0);
	await expect(expandAll).toBeEnabled();

	// Either click while collapsed ALSO expands the group: the fold
	// result must show. Collapse-all folds the family and the group
	// stands open again — heads visible, child row still hidden.
	await collapseAll.click();
	await expect(page.getByTestId('sidebar-panel-group-toggle')).toHaveAttribute(
		'aria-expanded',
		'true'
	);
	await expect(childRow).toHaveCount(0);
	await expect(collapseAll).toBeDisabled();
	await expect(expandAll).toBeEnabled();

	// Focus-reveal end to end: the child has held the focus since the
	// fork, so first move it — a click on the source's panel header —
	// then click the folded child's header. PanelColumn selects on
	// pointerdown; the focus CHANGE onto a hidden row reveals its
	// family rather than hiding the focus.
	const sourceHeader = page
		.locator(`[data-testid="panel-column"][data-session-id="${STUB_SESSION_ID}"]`)
		.locator('[data-testid="panel-header"]');
	const childHeader = page
		.locator(`[data-testid="panel-column"][data-session-id="${child}"]`)
		.locator('[data-testid="panel-header"]');
	await sourceHeader.click();
	await childHeader.click();
	await expect(childRow).toBeVisible();
	await expect(expandAll).toBeDisabled(); // the reveal unfolded the family
	await expect(collapseAll).toBeEnabled();
});
