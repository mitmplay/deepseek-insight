import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
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

test('headed demo - ls -a in the web terminal', async ({ page }) => {
	writeFileSync('/tmp/dsi-terminal-demo-settings.yaml', 'terminal:\n  enabled: true\n', 'utf-8');
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible({ timeout: 30_000 });

	const input = page.locator('textarea').first();
	await input.fill('/dsi-terminal');
	for (let attempt = 0; attempt < 5; attempt++) {
		await input.press('Enter');
		await page.waitForTimeout(1_500);
		const value = await input.inputValue().catch(() => '');
		if (!value.includes('/dsi-terminal')) break;
	}
	await expect(page.getByTestId('panel-terminal')).toBeVisible({ timeout: 20_000 });

	await page.getByTestId('terminal-host').click();
	await page.keyboard.type('ls -a', { delay: 120 });
	await page.keyboard.press('Enter');
	await page.waitForTimeout(8_000); // hold the result on screen
	await page.screenshot({ path: 'test-results/terminal-ls-a.png', fullPage: false });

	const list = (await (await page.request.get('/api/terminal')).json()) as { sessions: Array<{ id: string }> };
	const id = list.sessions[0]?.id;
	const out = (await (await page.request.get('/api/terminal/' + id + '/output?fromByte=0')).json()) as { text: string };
	const stripped = out.text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '');
	// The typed echo is scrambled by starship prompt redraws (display-level
	// artifact only) — the OUTPUT is what must be verifiable: a real listing
	// with hidden dot-entries.
	expect(stripped).toContain('.zsh_history');
	expect(stripped).toContain('.DS_Store');
	await page.waitForTimeout(6_000); // linger so the operator can see the screen
});
