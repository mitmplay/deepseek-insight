/** TEMP SPEC — File Link Intent Wave 2 acceptance (headed, operator-visible):
 *  1. open the seeded session; click the workspace chip -> the explorer opens;
 *  2. click the assistant markdown file link [plain.txt](notes/plain.txt);
 *  3. expect the explorer panel to open the file in a tab (stub text visible),
 *     and NO navigation away (the server never sees a plain-path GET). */
import { expect, test } from '@playwright/test';
import { DshStubHost } from './dsh-stub';

const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;
const SID = 'e2e-flink-session';

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
	const state = (await (await fetch(stubCtl)).json()) as { extraSessions: unknown[] };
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			extraSessions: [
				...state.extraSessions,
				{
					sessionId: SID,
					title: 'file link seed',
					agentPreset: null,
					cwd: '/tmp',
					ledger: [
						{ event: { type: 'turn/start', seq: 100, time: 1787212000001, data: {} } },
						{
							event: {
								type: 'assistant/message',
								seq: 101,
								time: 1787212000002,
								data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Open [plain.txt](notes/plain.txt) here.' }] } }
							}
						},
						{ event: { type: 'turn/end', seq: 102, time: 1787212000003, data: {} } }
					]
				}
			]
		})
	});
});

test.afterAll(async () => {
	await stub?.stop();
});

test('clicking a markdown file link opens the explorer file tab', async ({ page }) => {
	test.setTimeout(45_000);
	await page.goto(`/?sessionKey=${SID}`);
	await expect(page.getByText('Open', { exact: false }).first()).toBeVisible();

	// 1. the header workspace chip opens the explorer panel
	const chip = page.getByRole('banner').getByRole('button', { name: 'file link seed' });
	await expect(chip).toBeVisible();
	await chip.click();
	await page.waitForTimeout(800);

	// 2. the markdown file link
	const link = page.locator('a[href="notes/plain.txt"]').first();
	await expect(link).toBeVisible();
	const navStarted = page
		.waitForURL('**/notes/plain.txt**', { timeout: 2500 })
		.then(() => true)
		.catch(() => false);

	await link.click();
	await page.waitForTimeout(1500);
	expect(await navStarted).toBe(false); // no navigation — client intent

	// 3. the file tab opened inside the explorer (stub text visible)
	await expect(page.getByText('plain fixture line 1').first()).toBeVisible();
	const body = await page.evaluate(() => document.body.textContent || '');
	console.log('FLINK EVIDENCE:', JSON.stringify({ hasFixtureText: body.includes('plain fixture line 2'), hasIdeamd: body.includes('plain.txt') }));
});
