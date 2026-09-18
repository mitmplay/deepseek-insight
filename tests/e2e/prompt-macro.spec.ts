/**
 * E2E: DSI Prompt Macro (2026-08-29, Wave 3 task 3.1) — the operator
 * journeys against the stub DSH host with the prompts routes REAL over a
 * disposable `DSI_PROMPTS_DB` (the suggest-strip W4 seam, config webServer).
 * Env notes: spec files run serialized (workers: 1), each file owns the
 * stub port for its lifetime (suggest-strip pattern).
 *
 * Section truth (Sectioned Row Macro, W3 3.1): journeys 01-03 were pinned
 * to the OLD line grammar; single-instruction rows compile one-to-one (same
 * kind, same wire), so their assertions stand EXCEPT the /permission mark —
 * kind `command` is instantly ✓ on the sheet (W2 2.2 killed the note-text
 * sniffing that left it ⏳-queued). Journey 04 pins the SECTIONED wire: the
 * four-section motivating row of the Sectioned Row ADR.
 *
 * Fixture shelf (seeded per test):
 *   macro row  = "/new @main\n?list files" — THE two-line routine (label
 *                'new-main-routine'): line 1 mints a successor @main
 *                session, line 2 resolves `list files` against the shelf
 *                and lands its text in the NEW session.
 *   target row = "list all files in the workspace" (label 'list-files') —
 *                the `?list files` resolution (top hit by use_count).
 *
 * Why @main (not the ADR's @code): the stub host lists exactly research +
 * main (STUB_PRESETS); session.create with any other preset fails
 * preset-not-found. The journey's pinned fact is preset INHERITANCE into
 * the create body — @main proves the same wire contract.
 *
 * Journey 1 — run-all (Karpathy L2 success threshold): type `!new` → strip
 * in RUN mode (⏯ Step present, Enter runs) → Enter → sessions POST carries
 * {agentPreset:'main', cwd:'/tmp'} → the resolved target text is POSTed to
 * the NEW session id (queue mode) → /api/prompts use_count +1 for the
 * TARGET row only (the macro row itself never records — its lines are
 * command + query, not ordinary sends) → run ends `fed`.
 *
 *   Chip-across-the-swap (remediated 2026-08-29, "ownership follows the
 *   target session"): doReplacePanel mints a NEW panel id and the page
 *   keys ConversationPanel by {#key panel.sessionId} — the successor
 *   panel REMOUNTS. The runner (module scope) holds targetSessionId +
 *   the ✓/▶ baseline and retargets both at the /new handoff, so the
 *   successor panel CLAIMS the chip by showing the run's session: the
 *   chip crosses the swap, and the journey asserts BOTH the wire (prompt
 *   POST to the new session id + /use on the target row) and the chip's
 *   fed label on the successor panel.
 *
 * Journey 2 — step/hold (D10): ⏯ Step starts the run HELD (zero prompt
 * POSTs), the held sheet shows Feed next / Run all / Abort, Feed next
 * submits exactly ONE line (/new → swap), then Run all releases the rest
 * (resolution lands). Uses a /permission + plain line macro so the panel
 * does NOT remount mid-run (the chip lives to show held → fed).
 *
 * Journey 3 — question-stall suffix (D5/D7, human gate): a plain macro
 * line while a question card pends → chip suffix `the harness is asking`;
 * answering VIA THE CARD (operator, never the macro) unblocks and the run
 * ends fed. Proves the macro never auto-answers.
 *
 * Journey 4 — the SECTIONED motivating row (Sectioned Row ADR; preset
 * adapted @code→@main — see the @main note above): mention + 2-line message,
 * /new @main, a 3-bullet block, /new @main again. compileRow yields exactly
 * 4 sections; the wire proves the grammar: the mention POST carries the
 * two-line message to the seeded target, ONE prompt POST carries the three
 * bullets verbatim (newlines intact) to the FIRST new session, two sessions
 * POSTs carry preset main, and the chip walks 1/4 → 4/4 across the swap.
 * Isolation (BC-10 class, prompts-seam precedent): the mention registers a
 * delegation row via /api/a2a/register → the operator's real
 * ~/.dsi/a2a.sqlite. The a2a isolation lives only in
 * playwright.a2a.config.ts's process env, so this spec seeds the stub and
 * points the app server at a per-run tmp ledger by hand —
 * DSI_CONFIG_PATH/DSI_A2A_DB /__e2e/* knobs on the stub (test-owned seam,
 * byte-identical mechanism to the config seam: env in, preview restarts).
 *
 * Selectors verified in component source (skill Step 3.8): prompt-textarea /
 * suggest-strip / [role=option][aria-selected] (StripChip strip-pick) /
 * strip-step-btn (aria-label "Step this macro") / macro-chip / macro-sheet /
 * macro-line[data-state] / macro-feednext / macro-runall / macro-abort /
 * question-card buttons (questions.test.ts contract).
 */

import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildDeliveredText } from '../../src/lib/services/chat/a2a-protocol';
import { DshStubHost, STUB_SESSION_ID, STUB_PRESETS, stubAnswerer } from './dsh-stub';

const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;

const PROMPTS_DB =
	process.env.DSI_PROMPTS_DB ?? join(tmpdir(), 'dsi-e2e-prompts.sqlite');

/** The two-line routine (the ADR's saved-row shape, preset adapted to the
 *  stub catalog — see header). */
const MACRO_TEXT = '/new @main\n?list files';
const MACRO_LABEL = 'new-main-routine';
/** The `?list files` target — the top hit by use_count. */
const TARGET_TEXT = 'list all files in the workspace';
const TARGET_LABEL = 'list-files';
/** A macro whose lines never remount the panel (held journey). The
 *  plain line deliberately avoids the substring "perm" so seeding it
 *  never pollutes the `!perm` strip query. */
const PLAIN_LINE = 'check the open review threads';
const PERM_MACRO_TEXT = '/permission read-only\n' + PLAIN_LINE;
const PERM_MACRO_LABEL = 'perm-routine';
/** The seeded use_count of the plain line — /use bumps it by one. */
const PLAIN_USES = 4;

let stub: DshStubHost | undefined;
let tmpDir: string;

function seedPromptsDb(rows: Array<{ label: string | null; text: string; use_count: number }>): void {
	const db = new DatabaseSync(PROMPTS_DB);
	db.exec(`
		CREATE TABLE IF NOT EXISTS prompts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			label TEXT,
			text TEXT NOT NULL,
			use_count INTEGER NOT NULL DEFAULT 1,
			last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			UNIQUE(text)
		);
		CREATE INDEX IF NOT EXISTS idx_prompts_text ON prompts(text);
		CREATE INDEX IF NOT EXISTS idx_prompts_prune ON prompts(use_count, last_used_at);
		CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
			label, text, content='prompts', content_rowid='id', tokenize='trigram'
		);
		CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON prompts BEGIN
			INSERT INTO prompts_fts(rowid, label, text) VALUES (new.id, new.label, new.text);
		END;
		CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON prompts BEGIN
			INSERT INTO prompts_fts(prompts_fts, rowid, label, text)
			VALUES ('delete', old.id, old.label, old.text);
		END;
		CREATE TRIGGER IF NOT EXISTS prompts_au AFTER UPDATE OF label, text ON prompts BEGIN
			INSERT INTO prompts_fts(prompts_fts, rowid, label, text)
			VALUES ('delete', old.id, old.label, old.text);
			INSERT INTO prompts_fts(rowid, label, text) VALUES (new.id, new.label, new.text);
		END;
		CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_label ON prompts(label) WHERE label IS NOT NULL;
		PRAGMA user_version = 2;
	`);
	db.exec('DELETE FROM prompts');
	for (const r of rows) {
		db.prepare(
			"INSERT INTO prompts (label, text, use_count, last_used_at, created_at) VALUES (?, ?, ?, datetime('now', '-1 day'), datetime('now', '-1 day'))"
		).run(r.label, r.text, r.use_count);
	}
	db.close();
}

interface StubStateView {
	promptCalls: Array<{ sessionId: string; text: string; mode: string }>;
	createCalls: Array<{ agentPreset: string | null; cwd: string | null }>;
	permissionCalls: string[];
	createdSessions: string[];
	respondCalls?: Array<{ rpcId: string }>;
}

async function resetState(): Promise<void> {
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			promptCalls: [],
			permissionCalls: [],
			createCalls: [],
			createdSessions: [],
			listSessionId: STUB_SESSION_ID
		})
	});
	// Ghost-pending hygiene (diagnosed 2026-08-29 from the full-suite
	// trace): an EARLIER file's answer-while-mux-down spec leaves the DSI
	// server's pendingAnswers holding its rpcId forever — the resolved
	// broadcast only travels the mux downlink, which was down, and the
	// registry deletes ONLY on that frame. Every later poll for THIS
	// session then re-delivers the ghost and any answerer-aware surface
	// (the macro chip's asking suffix) reads a phantom question. Clear the
	// stub's answer registry so our own question is the ONLY pending
	// stub-side (the DSI-server side is purged in journey 03 — the ghost
	// ids are file-pinned and handled there).
	stubAnswerer!.resetAnswerRegistry();
}

async function stubState(): Promise<StubStateView> {
	const res = await fetch(stubCtl);
	return (await res.json()) as StubStateView;
}

async function fetchPromptRow(text: string): Promise<{ id: number; use_count: number } | null> {
	const res = await fetch(
		`http://127.0.0.1:5176/api/prompts?q=${encodeURIComponent(text)}&limit=10`
	);
	if (!res.ok) return null;
	const data = (await res.json()) as { results: Array<{ id: number; text: string; use_count: number }> };
	return data.results.find((r) => r.text === text) ?? null;
}

/** Fresh-stub posture: the current panel's session never ran a turn, so
 *  the stub's canned scenario is not in play; promptAutoTurn stays ON —
 *  the resolved line's receipt returns after the turn drains (mirrors the
 *  live host's queue semantics). */
test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
	tmpDir = mkdtempSync(join(tmpdir(), 'prompt-macro-e2e-'));
});

test.afterAll(async () => {
	await stub?.stop();
	rmSync(tmpDir, { recursive: true, force: true });
});

test.describe.configure({ mode: 'serial' });

test('01 · run-all — sessions POST carries the preset, resolution lands on the NEW session, /use records the target row only', async ({ page }) => {
	await resetState();
	seedPromptsDb([
		{ label: MACRO_LABEL, text: MACRO_TEXT, use_count: 5 },
		{ label: TARGET_LABEL, text: TARGET_TEXT, use_count: 9 },
		{ label: null, text: 'commit all and push', use_count: 3 }
	]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const box = page.getByTestId('prompt-textarea');
	await expect(box).toBeVisible();

	// `!new` — run mode: the strip appears with the macro row first
	// (contains match on 'new', ranked by use_count) and the ⏯ Step
	// button present (run-mode marker in the DOM).
	await box.fill('!');
	await box.pressSequentially('new');
	const strip = page.getByTestId('suggest-strip');
	await expect(strip).toBeVisible();
	const row = strip.locator('[role="option"]');
	// `new` matches ONLY the macro row ('/new @main\n?list files'
	// contains it; 'commit all and push' does not) — one option, and
	// it is the active one.
	await expect(row).toHaveCount(1);
	await expect(row.first()).toHaveAttribute('aria-selected', 'true');
	await expect(row.first()).toHaveAttribute('title', MACRO_TEXT);
	await expect(strip.locator('.strip-step-btn')).toHaveCount(1); // run mode

	// The stub catalog admits @main (guard: the fixture stays honest).
	expect(STUB_PRESETS.some((p) => p.id === 'main')).toBe(true);

	// Enter accepts in RUN mode: the row RUNS — never inserts.
	await box.press('Enter');
	await expect(strip).toHaveCount(0);
	await expect(box).toHaveValue('');

	// WIRE TRUTH 1 — the create carried preset + cwd inheritance.
	await expect
		.poll(async () => (await stubState()).createCalls, { timeout: 10_000 })
		.toHaveLength(1);
	const create = (await stubState()).createCalls[0];
	expect(create.agentPreset).toBe('main');
	expect(create.cwd).toBe('/tmp');
	const newSessionId = (await stubState()).createdSessions[0];
	expect(newSessionId).toMatch(/^e2e-created-/);

	// WIRE TRUTH 2 — the resolved text landed on the NEW session (queue
	// mode), not on the origin session.
	await expect
		.poll(async () => (await stubState()).promptCalls, { timeout: 10_000 })
		.toHaveLength(1);
	const prompt = (await stubState()).promptCalls[0];
	expect(prompt.sessionId).toBe(newSessionId);
	expect(prompt.text).toBe(TARGET_TEXT);
	expect(prompt.mode).toBe('queue');

	// WIRE TRUTH 3 — /use recorded for the TARGET row only: the macro row
	// itself is command+query lines (never ordinary sends), the unrelated
	// row never moved.
	await expect
		.poll(async () => (await fetchPromptRow(TARGET_TEXT))?.use_count ?? 0, { timeout: 10_000 })
		.toBe(10);
	expect((await fetchPromptRow(MACRO_TEXT))?.use_count).toBe(5);
	expect((await fetchPromptRow('commit all and push'))?.use_count).toBe(3);

	// The successor panel adopted the new session (the swap IS the /new
	// feedback): URL or panel content reflects the fresh session.
	await expect
		.poll(async () => (await stubState()).promptCalls.length, { timeout: 5_000 })
		.toBe(1);
	// Chip-across-the-swap (ownership follows the target session): the
	// origin panel REMOUNTED on the successor session (fresh panel id) —
	// the successor panel CLAIMS the chip because it shows the run's
	// target session. The fed label is the runner's own truth; the ✓/▶
	// rows re-baseline on the successor's empty store (baseline reset to
	// 0 at the /new handoff).
	await expect(page.getByTestId('macro-chip')).toBeVisible();
	await expect(page.getByTestId('macro-chip')).toContainText('fed');
});

test('02 · step/hold — Step starts held (zero posts), Feed next submits ONE section, Run all releases the rest', async ({ page }) => {
	await resetState();
	seedPromptsDb([
		{ label: PERM_MACRO_LABEL, text: PERM_MACRO_TEXT, use_count: 7 },
		{ label: null, text: PLAIN_LINE, use_count: PLAIN_USES }
	]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const box = page.getByTestId('prompt-textarea');
	await expect(box).toBeVisible();

	// `!perm` finds the perm routine (contains on 'perm').
	await box.fill('!');
	await box.pressSequentially('perm');
	const strip = page.getByTestId('suggest-strip');
	await expect(strip).toBeVisible();
	const row = strip.locator('[role="option"]');
	await expect(row.first()).toHaveAttribute('title', PERM_MACRO_TEXT);

	// ⏯ Step — held start: strip closes, draft clears, chip reads held
	// 0/2, ZERO lines posted (no permission call, no prompt POST).
	await strip.locator('.strip-step-btn').first().click();
	await expect(strip).toHaveCount(0);
	await expect(box).toHaveValue('');
	const chip = page.getByTestId('macro-chip');
	await expect(chip).toBeVisible();
	await expect(chip).toContainText('held');
	await expect(chip).toContainText('0/2');
	expect((await stubState()).permissionCalls).toEqual([]);
	expect((await stubState()).promptCalls).toEqual([]);

	// Expand the sheet — held controls visible, both lines pending (⊙).
	await chip.getByRole('button', { name: /macro/ }).click();
	const sheet = page.getByTestId('macro-sheet');
	await expect(sheet).toBeVisible();
	await expect(sheet.getByTestId('macro-held-controls')).toBeVisible();
	expect((await stubState()).permissionCalls).toEqual([]);

	// Feed next — exactly ONE line: the /permission command (host-side
	// preset flip, no prompt POST, no remount).
	await page.getByTestId('macro-feednext').click();
	await expect
		.poll(async () => (await stubState()).permissionCalls, { timeout: 5_000 })
		.toEqual(['/permission read-only']);
	expect((await stubState()).promptCalls).toEqual([]);
	await expect(chip).toContainText('1/2');
	// Section truth (W2 2.2): the /permission record's TYPED kind is
	// `command` — host-side and terminal, instantly ✓ on the sheet (the
	// note-sniffing classifier that left it ⏳-queued died in W2; the
	// between-blocks pairing shift with it).
	const permRow = sheet.getByTestId('macro-line').first();
	await expect(permRow).toHaveAttribute('data-state', 'done');
	await expect(permRow).toContainText('preset read-only');

	// Run all — releases the hold: the plain line POSTs (queue receipt),
	// the run ends fed, and /use records the plain line (seeded row +1 —
	// identical to a manual Tab+Enter send's record).
	await page.getByTestId('macro-runall').click();
	await expect
		.poll(async () => (await stubState()).promptCalls, { timeout: 10_000 })
		.toHaveLength(1);
	const prompt = (await stubState()).promptCalls[0];
	expect(prompt.text).toBe(PLAIN_LINE);
	await expect(chip).toContainText('fed', { timeout: 10_000 });
	await expect
		.poll(async () => (await fetchPromptRow(PLAIN_LINE))?.use_count ?? 0, { timeout: 10_000 })
		.toBe(PLAIN_USES + 1);
});

test('03 · stall — a pending question shows the asking suffix; answering VIA THE CARD unblocks the run', async ({ page }) => {
	await resetState();
	seedPromptsDb([
		{ label: null, text: 'summarize the open review threads', use_count: 4 }
	]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const box = page.getByTestId('prompt-textarea');
	await expect(box).toBeVisible();

	// Raise a question on the CURRENT session while a run is about to
	// feed a plain line into the SAME queue — the harness gate.
	// Ghost-pending hygiene FIRST (diagnosed 2026-08-29 from full-suite
	// traces): an earlier file's answer-while-mux-down spec (conversation
	// 20) leaves the DSI SERVER's pendingAnswers holding its rpcId — the
	// resolved broadcast never crossed the dead mux, and the registry
	// deletes ONLY on that frame, so it rides every later poll for this
	// session into the chip's pendingAnswers count. The stub-side
	// registry is already empty (its file died); the surgical purge is
	// rpcId-keyed: RE-RAISE the ghost's id (registerPending overwrites by
	// rpcId — idempotent), then settle it elsewhere — the resolved
	// broadcast makes the server's registerSettlement DELETE by rpcId.
	// The stub's list of still-pending ids is empty post-file, so re-raise
	// the known legacy ids explicitly.
	for (const ghost of ['stub-approval-rpc-1-5']) {
		stubAnswerer!.requestApproval({ rpcId: ghost });
		stubAnswerer!.settleElsewhere(ghost, 'allowed-once');
	}
	const rpcId = stubAnswerer!.requestQuestions({ rpcId: 'macro-stall-q1' });

	// `!summ` — one plain-line macro: accept runs it; the line's prompt
	// receipt is accepted (queue mode), the queue is stalled behind the
	// pending question — the chip must NAME the gate, never auto-answer.
	await box.fill('!');
	await box.pressSequentially('summ');
	const strip = page.getByTestId('suggest-strip');
	await expect(strip).toBeVisible();
	await expect(strip.locator('[role="option"]').first()).toHaveAttribute(
		'title',
		'summarize the open review threads'
	);
	await box.press('Enter');
	await expect(strip).toHaveCount(0);

	// The prompt POSTed (receipt accepted — queue mode admits while a
	// question pends; the TURN stalls, not the admission).
	await expect
		.poll(async () => (await stubState()).promptCalls, { timeout: 10_000 })
		.toHaveLength(1);
	const chip = page.getByTestId('macro-chip');
	await expect(chip).toBeVisible({ timeout: 10_000 });
	// The asking suffix (D5) — on the chip text.
	await expect(chip).toContainText('the harness is asking', { timeout: 10_000 });

	// The card is on the floor and UNANSWERED (the macro never answers).
	const card = page.getByTestId('question-card').first();
	await expect(card).toBeVisible({ timeout: 10_000 });

	// Answer via the card (the operator's arm, not the macro's): q1's
	// first option + q2's first option (every question needs an answer —
	// conversation.spec 18 contract), then Answer — the question wire
	// settles, the suffix clears, the run fed.
	await card.locator('[data-testid="question-option"][data-label="Quick scan"]').click();
	await card.locator('[data-question-id="q2"] [data-testid="question-option"]').first().click();
	await expect(card.getByTestId('question-submit')).toBeEnabled();
	await card.getByTestId('question-submit').click();
	await expect(chip).not.toContainText('the harness is asking', { timeout: 10_000 });
	await expect(chip).toContainText('fed');
	// The respond arm proves the answer rode the answerer wire.
	await expect
		.poll(async () => {
			const res = await fetch(stubCtl);
			const s = (await res.json()) as { respondCalls?: Array<{ rpcId: string }> };
			return s.respondCalls?.map((r) => r.rpcId) ?? [];
		}, { timeout: 10_000 })
		.toContain(rpcId);
});


// ── 04 · the sectioned motivating row ───────────────────────────────

/** The seeded mention target — an extraSessions row (own ledger, seeded
 *  completed turns = the spine watermark), planted before the app lists
 *  the spine. Run-unique uuid tail (freshSigId discipline, a2a.spec):
 *  a REUSED prompts DB can never cross-match a previous run's rows. */
function freshUuid(): string {
	const h = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
	return `${h(8)}-${h(4)}-${h(4)}-${h(4)}-${h(12)}`;
}
const MENTION_UUID = freshUuid();
const MENTION_SID = `session-${MENTION_UUID}`;
/** One shared strip query over the macro row only — 'oldest' appears in
 *  bullet 1 and NOWHERE else in the fixture (guards contains-match). */
const J4_STRIP_QUERY = 'oldest';

/** The four-section row (ADR §1; preset @code→@main — stub catalog, see
 *  header). compileRow: mention-block (inline msg + line 2), /new, ONE
 *  3-bullet send-block, /new. The a2a id rides the mention line so the
 *  delivered-text assertion knows the exact bytes (buildDeliveredText
 *  appends the protocol sentence with this id). */
const J4_LABEL = 'sectioned routine';
const J4_BULLET_1 = 'review the open PRs, oldest first';
const J4_BULLET_2 = 'note anything that blocks a merge';
const J4_BULLET_3 = 'post a summary when done';
const J4_BLOCK_TEXT = [J4_BULLET_1, J4_BULLET_2, J4_BULLET_3].join('\n');
const J4_MENTION_MSG = 'you have the review floor\nstart with the oldest open PR';
// a2a id: run-unique hex (freshSigId discipline, a2a.spec) — a reused tmp
// ledger can never collide with a previous run's row; the id rides the
// mention line, so the delivered-bytes assertion knows it exactly.
const J4_A2A_ID = `a2a-${Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
const J4_MACROS_TEXT = [
	`@session-${MENTION_UUID} _a2a_:${J4_A2A_ID}; ${J4_MENTION_MSG}`,
	'/new @main',
	J4_BLOCK_TEXT,
	'/new @main'
].join('\n');
/** The exact delivered bytes: the two-line message + the injected
 *  protocol sentence carrying J4_A2A_ID (runMention → buildDeliveredText). */
const J4_DELIVERED = buildDeliveredText(J4_MENTION_MSG, J4_A2A_ID);

test('04 · sectioned row — 4 sections, mention message lands whole, block POSTs ONCE, chip 4/4 on the final panel', async ({ page }) => {
	test.setTimeout(120_000);
	await resetState();

	// Plant the mention target (a2a.spec seedTarget pattern: merged wholes
	// — POST /__e2e/state Object.assigns, arrays REPLACE).
	const pre = await fetch(stubCtl).then((r) => r.json()) as {
		extraSessions: Array<Record<string, unknown>>;
		sessionTurns: Record<string, number>;
	};
	const seedLedger = [
		{ event: { type: 'turn/start', seq: 11, time: 1787212000001, data: {} } },
		{ event: { type: 'assistant/message', seq: 13, time: 1787212000002, data: { turn: 2, step: 1, message: { content: [{ type: 'text', text: 'Seeded target reply from before the delegation.' }] } } } },
		{ event: { type: 'turn/end', seq: 14, time: 1787212000003, data: {} } }
	];
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			extraSessions: [
				...pre.extraSessions,
				{ sessionId: MENTION_SID, title: 'review helper', agentPreset: 'research', cwd: '/tmp', ledger: seedLedger }
			],
			sessionTurns: { ...pre.sessionTurns, [MENTION_SID]: 3 }
		})
	});
	seedPromptsDb([
		{ label: J4_LABEL, text: J4_MACROS_TEXT, use_count: 6 },
		{ label: 'review helper', text: 'review the open PRs on the floor', use_count: 2 }
	]);

	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const box = page.getByTestId('prompt-textarea');
	await expect(box).toBeVisible();

	// `!oldest` — the strip shows ONLY the sectioned row (contains match
	// on 'oldest': bullet 1 has it; no other seeded row does).
	await box.fill('!');
	await box.pressSequentially(J4_STRIP_QUERY);
	const strip = page.getByTestId('suggest-strip');
	await expect(strip).toBeVisible();
	const options = strip.locator('[role="option"]');
	await expect(options).toHaveCount(1);
	await expect(options.first()).toHaveAttribute('title', J4_MACROS_TEXT);
	await expect(strip.locator('.strip-step-btn')).toHaveCount(1); // run mode

	// Enter accepts in RUN mode — the row RUNS as 4 sections. NOTE: the
	// FIRST section is the mention — its executor OPENS the target's panel
	// on the floor (the delegation contract), so TWO compositors exist from
	// here on; the draft assertion scopes to the origin panel's composer.
	await box.press('Enter');
	await expect(strip).toHaveCount(0);
	await expect(page.getByTestId('prompt-textarea').first()).toHaveValue('');

	// WIRE TRUTH 1 — the mention: ONE prompt POST to the seeded target
	// carrying the two-line message + protocol line, verbatim (queue mode).
	await expect
		.poll(async () => (await stubState()).promptCalls.filter((c) => c.sessionId === MENTION_SID), { timeout: 10_000 })
		.toHaveLength(1);
	const mentionCall = (await stubState()).promptCalls.find((c) => c.sessionId === MENTION_SID)!;
	expect(mentionCall.text).toBe(J4_DELIVERED);
	expect(mentionCall.mode).toBe('queue');

	// WIRE TRUTH 2 — two creates, both preset main (cwd inherited /tmp),
	// two distinct new sessions.
	await expect
		.poll(async () => (await stubState()).createCalls, { timeout: 10_000 })
		.toHaveLength(2);
	const creates = (await stubState()).createCalls;
	expect(creates[0]).toEqual({ agentPreset: 'main', cwd: '/tmp' });
	expect(creates[1]).toEqual({ agentPreset: 'main', cwd: '/tmp' });
	const [firstNew, secondNew] = (await stubState()).createdSessions;
	expect(firstNew).toMatch(/^e2e-created-/);
	expect(secondNew).toMatch(/^e2e-created-/);
	expect(secondNew).not.toBe(firstNew);

	// WIRE TRUTH 3 — exactly ONE block POST: the three bullets verbatim
	// (newlines intact) into the FIRST new session (fed before the second
	// /new retarget). The whole run made exactly two prompt POSTs — the
	// mention and the block, nothing else (no line-per-line leak).
	const blockCalls = (await stubState()).promptCalls.filter(
		(c) => c.sessionId === firstNew && c.text === J4_BLOCK_TEXT
	);
	expect(blockCalls).toHaveLength(1);
	expect(blockCalls[0].mode).toBe('queue');
	expect((await stubState()).promptCalls).toHaveLength(2);

	// WIRE TRUTH 4 — /use recorded the BLOCK once (one section = one
	// send = one record; the macro row itself never records).
	await expect
		.poll(async () => (await fetchPromptRow(J4_BLOCK_TEXT))?.use_count ?? 0, { timeout: 10_000 })
		.toBe(1);
	expect((await fetchPromptRow(J4_MACROS_TEXT))?.use_count).toBe(6);

	// The chip — claimed by the FINAL successor panel (second /new swap),
	// fed, naming 4 sections. The walk itself (1/4 → 4/4 across two
	// swaps) is unit-pinned; here the end-state on the successor panel is
	// the proof the ownership handoff survived both remounts.
	const chip = page.getByTestId('macro-chip');
	await expect(chip).toBeVisible({ timeout: 10_000 });
	await expect(chip).toContainText('fed', { timeout: 15_000 });
	await expect(chip).toContainText('4 sections');
	// Expand the sheet on this panel: all four section rows, kind-driven.
	const sheet = page.getByTestId('macro-sheet');
	await expect(sheet).toHaveCount(0); // collapsed after the remount
	await chip.getByRole('button', { name: /macro/ }).click();
	await expect(sheet).toBeVisible();
	const rows = sheet.getByTestId('macro-line');
	await expect(rows).toHaveCount(4);
	// Mention row: ↗ — the a2a chip stack owns its progress.
	await expect(rows.nth(0)).toHaveAttribute('data-state', 'sent to target');
	await expect(rows.nth(0)).toContainText('+1 lines');
	// Both /new rows: instantly ✓ (kind command — host-side terminal).
	await expect(rows.nth(1)).toHaveAttribute('data-state', 'done');
	await expect(rows.nth(3)).toHaveAttribute('data-state', 'done');
	// The block row: queued ✓ — verbatim display (first bullet + '+2
	// lines') and its ONE POST is already wire-proven above; the ✓ upgrade
	// pairs against THIS panel's store, and the block's turn landed in the
	// FIRST new session's transcript — not this (final successor) panel's.
	// The ✓/▶ pairing across a mid-run swap is unit-pinned semantics; here
	// the wire truth (one POST, bullets verbatim) is the contract.
	await expect(rows.nth(2)).toContainText(J4_BULLET_1);
	await expect(rows.nth(2)).toContainText('+2 lines');
});
