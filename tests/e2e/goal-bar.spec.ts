/**
 * E2E: DSI Goal Bar (2026-09-08, ADR "The Goal Bar") — the composer-docked
 * goal chip against the stub DSH host: the planted goal projection renders
 * the chip; Pause/Resume ride the host's goals/* Remotes with the CAS ref (the stub
 * records the verb receipts and advances its projection; the chip follows
 * within one poll); Clear folds the projection to null and the bar
 * disappears; a no-goal session renders nothing; the transcript gains no
 * entries from an action (command paperwork stays silent end-to-end).
 *
 * ISOLATION: the goal is planted on a DEDICATED extra session (never the
 * shared STUB_SESSION_ID). The preview server's dsh-connection keeps its
 * per-session projections map across stub restarts, so a planted key on the
 * shared session would leak into every later spec file in the invocation.
 */

import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

// All spec files share the webServer's DSH_BASE_URL port (4590); workers:1
// serializes files, so each beforeAll owns the port for its file.
const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;

/** The dedicated goal session (own ledger via extraSessions — GAP-5). */
const GOAL_SESSION_ID = 'e2e-goal-session-0042';
/** Goal Editor W3: a second dedicated session — tests 04/05 mutate mid-session,
 *  and a session that received a mid-session goals/* broadcast must never be
	 *  cold-loaded again in-file (the preview server's cached projection waterline
	 *  then exceeds the stub's ledger cursor — the past-cursor 503). */
const GOAL_EDITOR_SESSION_ID = 'e2e-goal-editor-0044';
const GOAL_EDITOR_SESSION_2_ID = 'e2e-goal-editor-0045';

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
	// Seed the goal session ONCE per file: the preview server caches the
	// session.list row (its projections.asOfSeq drives page calls), so
	// recreating the ledger mid-file desyncs the cached cursor (past-cursor
	// 503 on the next cold load). Per-test resets touch goal state only.
	await resetState();
});

test.afterAll(async () => {
	await stub?.stop();
});

/** The host's GoalProjection shape (packages/goal/goal/src/types.ts). */
function goalProjection(phase: 'active' | 'paused' = 'active') {
	return {
		goal: {
			id: 'goal-e2e-1',
			revision: 3,
			objective: 'finish the goal bar wave',
			phase,
			maxGoalRounds: 8
		},
		roundsStarted: 2,
		createdAt: Date.now() - 60_000,
		updatedAt: Date.now() - 10_000
	};
}

interface StubStateView {
	goal?: { goal?: { objective?: string } } | null;
	goalCalls: string[];
	ledger: Array<{ event: { type: string } }>;
}

async function stubState(): Promise<StubStateView> {
	const res = await fetch(stubCtl);
	return (await res.json()) as StubStateView;
}

async function resetState(): Promise<void> {
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			goalCalls: [],
			goal: undefined,
			lastSeq: 1_000_000,
			// The goal session's OWN ledger (never the shared fixture's).
			extraSessions: [
				{ sessionId: GOAL_SESSION_ID, title: 'Goal bar session', agentPreset: 'main', cwd: '/tmp/goal-e2e', ledger: [] },
				{ sessionId: GOAL_EDITOR_SESSION_ID, title: 'Goal editor session', agentPreset: 'main', cwd: '/tmp/goal-editor-e2e', ledger: [] },
				{ sessionId: GOAL_EDITOR_SESSION_2_ID, title: 'Goal editor session 2', agentPreset: 'main', cwd: '/tmp/goal-editor-e2e-2', ledger: [] }
			]
		})
	});
}

/** Per-test reset — goal state only (the session fixture stays put). */
async function resetGoal(): Promise<void> {
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ goalCalls: [], goal: undefined })
	});
}

/** Plant the projection through the control surface (the broadcast keeps
 *  an already-open session's bar fresh; a pre-nav plant bakes into the
 *  follow snapshot). */
async function plantGoal(value: unknown): Promise<void> {
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ goal: value })
	});
}

test('01 · a planted goal renders the chip; Pause and Resume ride the goals/* verbs and the chip follows', async ({
	page
}) => {
	await resetGoal();
	await plantGoal(goalProjection('active'));
	await page.goto(`/?sessionKey=${GOAL_SESSION_ID}`);

	// The chip shows phase + objective.
	const chip = page.getByTestId('goal-chip');
	await expect(chip).toBeVisible();
	await expect(chip).toContainText('active');
	await expect(chip).toContainText('finish the goal bar wave');

	// Ledger silence baseline BEFORE any action.
	const before = (await stubState()).ledger.length;

	// Pause: the CAS mutation reaches the stub as goals/pause.
	await page.getByTestId('goal-pause').click();
	await expect.poll(async () => (await stubState()).goalCalls).toEqual(['pause']);

	// The stub advanced its projection; the chip follows within one poll.
	await expect(chip).toHaveAttribute('data-phase', 'paused', { timeout: 15_000 });
	await expect(chip).toContainText('paused');
	await expect(page.getByTestId('goal-resume')).toBeVisible();

	// Resume: same wire, back to active.
	await page.getByTestId('goal-resume').click();
	await expect.poll(async () => (await stubState()).goalCalls).toEqual(['pause', 'resume']);
	await expect(chip).toHaveAttribute('data-phase', 'active', { timeout: 15_000 });

	// Transcript silence: the ledger gained ONLY goal paperwork
	// (durable goal/change — in dsh-events SILENT_TYPES); no
	// user/message entry ever rendered from the clicks.
	const state = await stubState();
	const added = state.ledger.slice(before).map((r) => r.event.type);
	expect(added.filter((t) => t !== 'goal/change')).toEqual([]);
});

test('02 · Clear folds the projection to null and the bar disappears', async ({ page }) => {
	// Continues from test 01's OWN stub state (active, whatever revision the
	// mutations reached): re-planting a DIFFERENT revision here would race
	// the preview server's cached projection and the click's CAS ref would
	// honestly lose. A fresh page, the chip, then Clear.
	await page.goto(`/?sessionKey=${GOAL_SESSION_ID}`);
	const chip = page.getByTestId('goal-chip');
	await expect(chip).toBeVisible();

	await page.getByTestId('goal-clear').click();
	await expect.poll(async () => (await stubState()).goalCalls).toEqual(['pause', 'resume', 'clear']);
	await expect(page.getByTestId('goal-bar')).toHaveCount(0, { timeout: 15_000 });
});

test('03 · a no-goal session renders no chip at all', async ({ page }) => {
	await resetGoal();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await page.getByTestId('access-mode-chip').waitFor({ state: 'visible', timeout: 15_000 });
	await expect(page.getByTestId('goal-bar')).toHaveCount(0);
	await expect(page.getByTestId('goal-chip')).toHaveCount(0);
});
test('04 · Edit opens the pre-filled form; submitting the changed objective rides goals/edit and the chip follows', async ({
	page
}) => {
	await resetGoal();
	await plantGoal(goalProjection('paused'));
	await page.goto(`/?sessionKey=${GOAL_EDITOR_SESSION_ID}`);
	await expect(page.getByTestId('goal-chip')).toBeVisible();

	await page.getByTestId('goal-edit').click();
	const objective = page.getByTestId('goal-edit-objective');
	await expect(objective).toHaveValue('finish the goal bar wave');

	await objective.fill('finish the goal bar wave, edited');
	await page.getByTestId('goal-edit-submit').click();

	// The edit reaches the stub and the chip repaints from the projection.
	await expect(page.getByTestId('goal-chip')).toContainText('finish the goal bar wave, edited', {
		timeout: 15_000
	});
	const state = await stubState();
	expect(state.goalCalls).toContain('edit');
	// No refusal banner anywhere on the bar.
	await expect(page.getByText('the goal moved')).toHaveCount(0);
});

test('05 · a goal moved between render and submit — the edit reports the host refusal and the form stays open', async ({
	page
}) => {
	// Fresh session (see GOAL_EDITOR_SESSION_ID note) — the moved-goal plant
	// bumps the REVISION so the rendered ref (revision 3) is stale host-side.
	const editorGoal = (revision: number) => {
		const g = goalProjection('paused');
		g.goal.id = 'goal-editor-1';
		g.goal.revision = revision;
		return g;
	};
	await resetGoal();
	await plantGoal(editorGoal(3));
	await page.goto(`/?sessionKey=${GOAL_EDITOR_SESSION_2_ID}`);
	await expect(page.getByTestId('goal-chip')).toBeVisible();

	await page.getByTestId('goal-edit').click();
	await expect(page.getByTestId('goal-edit-form')).toBeVisible();
	// The goal MOVED after render (the round driver's churn, simulated):
	// the operator's ref is now stale against the host revision.
	await plantGoal(editorGoal(4));
	await page.getByTestId('goal-edit-objective').fill('a doomed edit');
	await page.getByTestId('goal-edit-submit').click();

	// The refusal names the host's reason; the editor stays open for a retry.
	await expect(page.getByText('the goal moved')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId('goal-edit-form')).toBeVisible();
	const state = await stubState();
	expect(state.goalCalls).toContain('edit');
	expect(state.goal?.goal?.objective).toBe('finish the goal bar wave');
});
