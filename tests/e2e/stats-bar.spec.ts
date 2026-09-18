/**
 * E2E: ConversationStatsBar (spec Wave 3, task 3.2 — ADR 2026-09-08
 * "The Stats Bar"). Against the stub DSH host:
 *   AC1 — an empty session renders no bar
 *   AC2 — agent panel: bar above composer-area, fixed height, outside the transcript
 *   AC3 — sub-agent panel: bar is the bottom row, composer stays fenced out,
 *         floating stick toggle still overlays
 *   AC5 — real-browser geometry: constant one-line height, no wrap
 *   D3  — segments absent from the ledger are absent from the bar
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590;

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

type StubLedgerEntry = { event: { type: string; seq: number; time: number; data: Record<string, unknown> } };

async function plantState(body: Record<string, unknown>): Promise<void> {
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

const SUB_ID = 'e2e-sub-stats-0001';
const BLANK_ID = 'e2e-blank-stats-0001';

/** A minimal ledger tail: user bubble + finalized assistant message WITH
 *  usage accounting (cache read = 90 percent of total input). */
function childLedger(): StubLedgerEntry[] {
	const t = Date.now();
	return [
		{ event: { type: 'user/message', seq: 1, time: t - 5_000, data: { content: [{ type: 'text', text: 'run the sweep' }], id: 'sub-u1' } } },
		{
			event: {
				type: 'assistant/message',
				seq: 2,
				time: t - 1_000,
				data: {
					turn: 0,
					step: 1,
					message: { content: [{ type: 'text', text: 'sweep done' }] },
					usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900 }
				}
			}
		}
	];
}

test.afterEach(async () => {
	// fixture hygiene (sidebar.spec pattern): lineage + extras never leak
	await plantState({ lineageSessions: [], extraSessions: [] });
});

test('AC2 · agent panel: bar above composer-area, one line, honest segments', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const bar = page.getByTestId('conversation-stats-bar');
	await expect(bar).toBeVisible();
	// D3 honesty: the stub ledger carries NO usage events — no token or
	// cache segment may appear; counts and tool time do.
	await expect(bar).toContainText('turns');
	await expect(bar).toContainText('Tool');
	await expect(bar).not.toContainText('Cache hit');
	await expect(bar).not.toContainText('tok');
	// geometry: the bar sits OUTSIDE the transcript viewport and ABOVE the composer
	const barBox = await bar.boundingBox();
	const composer = page.locator('.composer-area');
	await expect(composer).toBeVisible();
	const composerBox = await composer.boundingBox();
	expect(barBox).not.toBeNull();
	expect(composerBox).not.toBeNull();
	expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(composerBox!.y + 1);
	expect(barBox!.height).toBeLessThan(30); // AC5: one line, never wraps
	const outsideTranscript = await bar.evaluate((el) => el.closest('[data-testid="transcript"]') === null);
	expect(outsideTranscript).toBe(true);
});

test('AC1 · an empty session renders no bar', async ({ page }) => {
	await plantState({
		extraSessions: [
			{ sessionId: BLANK_ID, title: 'Blank', agentPreset: null, cwd: '/tmp', ledger: [] }
		]
	});
	await page.goto(`/?sessionKey=${BLANK_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();
	await expect(page.getByTestId('conversation-stats-bar')).toHaveCount(0);
});

test('AC3 · sub-agent panel: bar is the bottom row, composer stays fenced out', async ({ page }) => {
	await plantState({
		lineageSessions: [{ sessionId: SUB_ID, parentSessionId: STUB_SESSION_ID, title: 'Spawned helper', running: false, cwd: '/tmp' }],
		extraSessions: [
			{ sessionId: SUB_ID, title: 'Spawned helper', agentPreset: null, cwd: '/tmp', ledger: childLedger() }
		]
	});
	await page.goto(`/?sessionKey=${SUB_ID}`);
	const bar = page.getByTestId('conversation-stats-bar');
	await expect(bar).toBeVisible();
	await expect(bar).toContainText('Cache hit 90%'); // usage reached the fold for THIS ledger
	// the fence still holds: no composer, stick toggle still overlays
	await expect(page.locator('.composer-area')).toHaveCount(0);
	await expect(page.getByTestId('floating-stick-toggle')).toBeVisible();
	// AC3/AC5 geometry: the bar is the LAST in-flow row of the column and one line tall
	const barBox = await bar.boundingBox();
	expect(barBox).not.toBeNull();
	expect(barBox!.height).toBeLessThan(30);
	const lastInFlow = await bar.evaluate((el) => {
		let node: Element | null = el;
		while (node!.nextElementSibling !== null) {
			node = node!.nextElementSibling;
			if (node.getAttribute('data-testid') === 'floating-stick-toggle') continue;
			if (node.tagName === 'DIV' && (node.textContent ?? '').length > 0 && node.children.length > 0) return false;
		}
		return true;
	});
	expect(lastInFlow).toBe(true);
});
