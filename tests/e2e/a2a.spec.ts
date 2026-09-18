/**
 * E2E: a2a delegation ledger (Wave 5 task 5.1) — the three journeys
 * Tasks.md pins, against the REAL app stack (vite preview + real server
 * watcher + real SQLite ledger) with DSH_BASE_URL pointed at the stub.
 *
 *   01 signature : @session-<uuid> _a2a_:<id>; msg → chip waiting → stub
 *                 flips a completed turn whose reply ENDS with the
 *                 signature suffix → chip “replied (exact)” → ledger row
 *                 settled replied_exact with reply text + turn
 *   02 timeout   : legal-floor 60000ms deadline (watchTimeoutMs gate is
 *                 [60000,3600000] — a faster deadline is ILLEGAL config
 *                 and the reader would silently revert to the 600000ms
 *                 default; the “fast deadline via config fixture” is met
 *                 at the legal floor — documented deviation) → timeout
 *                 row with honest error + chip “no reply (timeout)”
 *   03 naive     : mention WITHOUT a signature → minted id → reply with
 *                 NO signature → replied_approx → chip “may have replied”
 *                 (never the confident string — PRD risk row)
 *
 * Runner: playwright.a2a.config.ts pins DSI_CONFIG_PATH + DSI_A2A_DB to
 * /tmp/a2a-e2e (operator's ~/.dsi never touched). Under the BASE
 * config (full-suite run) this file self-skips — the journeys MUST NOT
 * run against the operator's real ledger/config.
 */

import { expect, test } from '@playwright/test';
import { DshStubHost, stubRuntime } from './dsh-stub';

const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;
const APP = 'http://127.0.0.1:5177';
const MAIN = 'e2e-stub-session-0001';
/** Seeded completed turns on every a2a target (send-time watermark). */
const SEED_TURNS = 3;

// The isolation env is pinned ONLY by playwright.a2a.config.ts — skip
// honestly under any other runner rather than touching the real ledger.
test.skip(() => !process.env.DSI_A2A_DB?.includes('a2a-e2e'), 'a2a journeys run only under playwright.a2a.config.ts (isolated /tmp ledger + config)');

// ── stub-state + ledger helpers ──────────────────────────────────────

interface StubPromptCall { sessionId?: string; text: string; mode: string; }
interface StubExtraSession { sessionId: string; title: string; agentPreset: string | null; cwd: string; ledger: Array<{ event: { type: string; seq: number; time: number; data: Record<string, unknown> } }> }
interface StubStateView { promptCalls: StubPromptCall[]; extraSessions: StubExtraSession[]; sessionTurns: Record<string, number>; }

async function stubState(): Promise<StubStateView> {
	return (await (await fetch(stubCtl)).json()) as StubStateView;
}

interface A2aRow {
	id: string; fromSession: string; toSession: string; state: string;
	message: string | null; replyText: string | null; replyTurn: number | null;
	error: string | null; sentAt: number; settledAt: number | null;
}

async function appRows(): Promise<A2aRow[]> {
	const res = await fetch(`${APP}/api/a2a?limit=100`);
	return ((await res.json()) as { rows: A2aRow[] }).rows;
}

async function appRow(id: string): Promise<A2aRow | null> {
	const res = await fetch(`${APP}/api/a2a/${id}`);
	if (res.status === 404) return null;
	return ((await res.json()) as { row: A2aRow }).row;
}

async function targetPrompts(sid: string): Promise<StubPromptCall[]> {
	return (await stubState()).promptCalls.filter((c) => c.sessionId === sid);
}

/** Run-unique full ledger id (a2a- + 16 hex — mintA2aId shape): journeys
 *  write the signature token themselves, so a REUSED ledger (a run without
 *  a fresh /tmp DB) can never PK-collide a previous run's row. */
function freshSigId(): string {
	const hex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
	return `a2a-${hex}`;
}

// ── per-test stub fixture: ONE fresh uuid-shaped target ───────────────

interface Target { uuid: string; sid: string; }

let seedCounter = 0;

async function seedTarget(label: string): Promise<Target> {
	seedCounter += 1;
	// uuid-shaped tail: 8-4-4-4-12 lowercase hex (MENTION_RE contract);
	// crypto-random digits (deterministic arithmetic produced all-f7 rows)
	const h = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
	const uuid = `${h(8)}-${h(4)}-${h(4)}-${h(4)}-${h(12)}`;
	const sid = `session-${uuid}`;
	const state = await stubState();
	// Plant: an extraSessions row (own ledger, one seeded completed turn)
	// + a turns watermark on the spine. POST /__e2e/state Object.assigns —
	// arrays/objects REPLACE, so send the merged wholes.
	const seedLedger = [
		{ event: { type: 'turn/start', seq: 11, time: 1787212000001, data: {} } },
		{ event: { type: 'assistant/message', seq: 13, time: 1787212000002, data: { turn: 2, step: 1, message: { content: [{ type: 'text', text: 'Seeded target reply from before the delegation.' }] } } } },
		{ event: { type: 'turn/end', seq: 14, time: 1787212000003, data: {} } }
	];
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			extraSessions: [...state.extraSessions, { sessionId: sid, title: `a2a target ${label}`, agentPreset: 'research', cwd: '/tmp', ledger: seedLedger }],
			sessionTurns: { ...state.sessionTurns, [sid]: SEED_TURNS }
		})
	});
	return { uuid, sid };
}

// ── the suite ─────────────────────────────────────────────────────────

let stub: DshStubHost | undefined;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

/** Open the MAIN session panel (the sender) and send one composer line. */
async function sendFromMain(page: import('@playwright/test').Page, line: string): Promise<void> {
	await page.goto(`/?sessionKey=${MAIN}`);
	await expect(page.getByTestId('transcript')).toBeVisible();
	await page.getByTestId('prompt-textarea').fill(line);
	await page.getByTestId('send-button').click();
}

// ── 01 · signature journey (exact tier) ───────────────────────────────

test('01 · signature mention → waiting chip → turn flip → replied (exact) → ledger replied_exact', async ({ page }) => {
	test.setTimeout(90_000);
	const target = await seedTarget('exact');
	const sigId = freshSigId();
	const sigToken = `_a2a_:${sigId};`;

	await sendFromMain(page, `@session-${target.uuid} ${sigToken} run the tests and report failures`);

	// waiting chip (spine join ≤ home.refreshMs + render)
	await expect(page.locator('[data-testid="a2a-chip"][data-a2a-state="waiting"]')).toBeVisible({ timeout: 15_000 });

	// row born waiting: composer-carried id, send-time watermark, sender = MAIN
	await expect
		.poll(async () => (await appRows()).find((r) => r.id === sigId) !== undefined, { timeout: 15_000 })
		.toBe(true);
	const born = (await appRows()).find((r) => r.id === sigId)!;
	expect(born.state).toBe('waiting');
	expect(born.fromSession).toBe(MAIN);
	expect(born.toSession).toBe(target.sid);
	expect(born.message).toBe('run the tests and report failures');
	expect(born.replyText).toBeNull();
	expect(born.replyTurn).toBeNull();
	expect(born.settledAt).toBeNull();

	// delivered text on the wire: signature stripped + protocol line injected
	await expect
		.poll(async () => {
			const calls = await targetPrompts(target.sid);
			return calls.length > 0 && calls[0].text.endsWith(sigToken);
		}, { timeout: 10_000 })
		.toBe(true);
	const delivered = (await targetPrompts(target.sid))[0].text;
	expect(delivered).toContain('Protocol: end your reply with exactly this signature as the final characters:');
	expect(delivered).toContain('run the tests and report failures');
	expect(delivered.startsWith('_a2a_:')).toBe(false);

	// flip ONE completed turn: reply ends with the signature suffix
	await stubRuntime!.flipA2aTurn(target.sid, `All tests passed. ${sigToken}`);

	// chip flips to the exact tier (REAL watcher settles the REAL ledger)
	await expect(page.locator('[data-testid="a2a-chip"][data-a2a-state="replied_exact"]', { hasText: 'replied (exact)' })).toBeVisible({ timeout: 20_000 });

	// ledger settled replied_exact: reply text + reply turn + settledAt
	await expect
		.poll(async () => (await appRow(sigId))?.state, { timeout: 20_000 })
		.toBe('replied_exact');
	const done = (await appRow(sigId))!;
	expect(done.replyText).toContain('All tests passed');
	expect(done.replyText!.endsWith(sigToken)).toBe(true);
	expect(done.replyTurn).not.toBeNull();
	expect(done.settledAt).not.toBeNull();
	expect(done.error).toBeNull();
});

// ── 02 · timeout journey (legal-floor 60000ms deadline) ───────────────

test('02 · silence past the legal-floor deadline → timeout row + honest error + chip hedge', async ({ page }) => {
	test.setTimeout(150_000);
	const target = await seedTarget('timeout');
	const sigId = freshSigId();
	const sigToken = `_a2a_:${sigId};`;

	await sendFromMain(page, `@session-${target.uuid} ${sigToken} silence please`);

	await expect
		.poll(async () => (await appRow(sigId))?.state, { timeout: 15_000 })
		.toBe('waiting');
	await expect(page.locator('[data-testid="a2a-chip"][data-a2a-state="waiting"]')).toBeVisible({ timeout: 15_000 });

	// SILENCE: no turn flip. The REAL watcher's deadline lane settles at the
	// legal-floor 60000ms (fixture /tmp/a2a-e2e/settings.yaml).
	await expect
		.poll(async () => (await appRow(sigId))?.state, { timeout: 100_000 })
		.toBe('timeout');
	const row = (await appRow(sigId))!;
	expect(row.error).toContain('no reply within');
	expect(row.settledAt).not.toBeNull();
	expect(row.replyText).toBeNull();

	// chip renders the timeout hedge verbatim
	await expect(page.locator('[data-testid="a2a-chip"][data-a2a-state="timeout"]', { hasText: 'no reply (timeout)' })).toBeVisible({ timeout: 15_000 });

	// zero-model-call proof for THIS journey: the only prompt the target
	// ever received is the delegation itself (queue mode, never a steer).
	const calls = await targetPrompts(target.sid);
	expect(calls.length).toBe(1);
	expect(calls[0].mode).toBe('queue');
});

// ── 03 · naive journey (no signature → approx tier, hedged chip) ──────

test('03 · naive mention → minted id → unattributed reply → replied_approx + “may have replied”', async ({ page }) => {
	test.setTimeout(90_000);
	const target = await seedTarget('naive');

	await sendFromMain(page, `@session-${target.uuid} just answer casually`);

	// the chip appears once the minted row exists (id unknown to the test —
	// find it via from+to, then pin it)
	await expect(page.locator('[data-testid="a2a-chip"][data-a2a-state="waiting"]')).toBeVisible({ timeout: 15_000 });
	let sigId = '';
	await expect
		.poll(async () => {
			const hit = (await appRows()).find((r) => r.fromSession === MAIN && r.toSession === target.sid && r.state === 'waiting');
			sigId = hit?.id ?? '';
			return sigId !== '';
		}, { timeout: 15_000 })
		.toBe(true);
	expect(sigId).toMatch(/^a2a-[0-9a-f]{16}$/); // minted shape

	// delivered text: minted protocol line for the minted id
	await expect
		.poll(async () => {
			const calls = await targetPrompts(target.sid);
			return calls.length > 0 && calls[0].text.endsWith(`_a2a_:${sigId};`);
		}, { timeout: 10_000 })
		.toBe(true);

	// the target replies WITHOUT echoing any signature (naive/ignored)
	await stubRuntime!.flipA2aTurn(target.sid, 'Sure, done when I got to it.');

	// ledger settles at the watermark tier — the honest hedge
	await expect
		.poll(async () => (await appRow(sigId))?.state, { timeout: 20_000 })
		.toBe('replied_approx');
	const row = (await appRow(sigId))!;
	expect(row.replyText).toContain('Sure, done');
	expect(row.replyTurn).not.toBeNull();

	// the chip shows the hedged text — NEVER the confident “replied” string
	const chip = page.locator('[data-testid="a2a-chip"][data-a2a-state="replied_approx"]');
	await expect(chip).toBeVisible({ timeout: 15_000 });
	await expect(chip).toContainText('may have replied');
	await expect(chip).not.toContainText('replied (exact)');
});
