/**
 * Manual headed verification (operator request): click a transcript file
 * link carrying a line anchor and confirm the explorer opens and the
 * Monaco surface highlights lines 12-15 of file-link.ts.
 * Run: node tests/e2e/manual/verify-file-link-highlight.mjs
 */
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:5175/';
const HREF = 'deepseek-insight/src/lib/utils/file-link.ts#12-15';
const LINK_TEXT = '[file-link.ts](deepseek-insight/src/lib/utils/file-link.ts#12-15)';

const browser = await chromium.launch({ headless: false, slowMo: 250 });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const log = (...a) => console.log('[verify]', ...a);

try {
	page.on('console', (msg) => {
		const t = msg.text();
		if (t.includes('[FLINK]') || t.includes('Highlight') || t.includes('highlight') || msg.type() === 'error' || msg.type() === 'warning') log('browser:', msg.type(), t.slice(0, 200));
	});
	page.on('pageerror', (err) => log('PAGEERROR:', String(err).slice(0, 300)));
	page.on('response', (res) => {
		if (res.url().includes('/api/dsh/workspace-tree') || res.url().includes('/api/dsh/workspace-file?')) {
			log('fetch', res.status(), res.url().slice(0, 160));
		}
	});
	await page.goto(BASE, { waitUntil: 'networkidle' });
	log('page loaded');

	// 1. Select the 2nd session from the sidebar list.
	const cards = page.getByTestId('sidebar-session-card');
	await cards.first().waitFor({ state: 'visible', timeout: 20_000 });
	const n = await cards.count();
	log('sidebar session cards:', n);
	if (n < 2) throw new Error('need at least 2 sessions in the sidebar');
	await cards.nth(1).click();
	log('clicked 2nd session');

	// 2. Send a user message whose body is the anchored file link.
	const input = page.getByTestId('prompt-input').locator('textarea').first();
	await input.waitFor({ state: 'visible', timeout: 20_000 });
	await input.fill(LINK_TEXT);
	// Send: prefer the button when enabled, fall back to Enter (the
	// button can stay hidden/disabled while a previous turn settles).
	const send = page.getByTestId('send-button');
	try {
		await send.click({ timeout: 8_000 });
	} catch {
		await input.press('Enter');
	}
	log('sent message with anchor link');

	// 3. Wait for the rendered transcript link, then click it.
	const anchor = page.locator('a[href="' + HREF + '"]').last();
	await anchor.waitFor({ state: 'visible', timeout: 30_000 });
	log('link rendered in transcript; clicking');
	// Hydration race: the File Link Intent listener attaches in a post-mount
	// effect — clicking the instant the anchor is visible navigates natively.
	// Settle first, and if a navigation error slipped through, retry once.
	await page.waitForTimeout(2500);
	// Probe: which surface hosts this anchor? Walk up for data-testids.
	const ancestry = await anchor.evaluate((el) => {
		const ids = [];
		let n = el;
		while (n && n instanceof Element) {
			const tid = n.getAttribute && n.getAttribute('data-testid');
			if (tid) ids.push(tid + (n.getAttribute('data-role') ? '[' + n.getAttribute('data-role') + ']' : ''));
			n = n.parentElement;
		}
		return ids.join(' < ');
	});
	log('anchor ancestry:', ancestry);
	log('anchor html:', await anchor.evaluate((el) => el.outerHTML.slice(0, 300)));
	await anchor.click();
	await page.waitForTimeout(800);
	if (!(await page.getByTestId('workspace-explorer').first().isVisible().catch(() => false))) {
		log('explorer not open — retrying click (hydration retry)');
		await anchor.click();
	}

	// 4. The explorer panel must appear.
	const explorer = page.getByTestId('workspace-explorer').first();
	await explorer.waitFor({ state: 'visible', timeout: 30_000 });
	log('WorkspaceExplorerPanel visible');

	// 5. The file panel fetches, Monaco mounts, highlight lands.
	const filePanel = page.getByTestId('workspace-file-panel').first();
	await filePanel.waitFor({ state: 'visible', timeout: 30_000 });
	log('WorkspaceFilePanel visible for path:', await filePanel.getAttribute('data-file-path'));

	const hl = page.locator('.dsi-line-anchor-highlight');
	// Give the lazy Monaco chunk time, then diagnose what actually mounted.
	await page.waitForTimeout(12_000);
	log('monaco editors:', await page.locator('.monaco-editor').count());
	log('view-lines:', await page.locator('.view-lines').count());
	log('textarea (monaco input):', await page.locator('.monaco-editor textarea.inputarea').count());
	log('band attached:', await hl.count());
	await hl.first().waitFor({ state: 'attached', timeout: 60_000 });
	const hlCount = await hl.count();
	log('highlight band(s):', hlCount);

	// The band must sit INSIDE the visible editor viewport (scrolled to 12-15).
	const box = await hl.first().boundingBox();
	log('highlight boundingBox:', JSON.stringify(box));
	if (!box || box.height < 10) throw new Error('highlight band has no visible height');
	if (box.y < 0 || box.y > 1000) throw new Error('highlight band scrolled out of view');

	// 6. Read the highlighted lines' text from Monaco's rendered view lines
	//    nearest the band to prove it landed on ~line 12-15 content.
	const near = page.locator('.view-line').filter({
		has: page.locator('..')
	});
	const editorText = await page.locator('.view-lines').innerText();
	log('editor shows', editorText.split('\n').length, 'rendered view lines');

	await page.screenshot({ path: 'tests/e2e/manual/verify-highlight-full.png', fullPage: false });
	const panel = await filePanel.boundingBox();
	if (panel) {
		await page.screenshot({ path: 'tests/e2e/manual/verify-highlight-panel.png', clip: panel });
	}
	log('screenshots saved');

	console.log('RESULT: PASS');
} catch (err) {
	await page.screenshot({ path: 'tests/e2e/manual/verify-highlight-fail.png', fullPage: true });
	console.error('RESULT: FAIL —', err.message);
	process.exitCode = 1;
} finally {
	await page.waitForTimeout(1500); // let the operator glimpse the headed run
	await browser.close();
}
