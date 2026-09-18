/**
 * E2E: composer attachment ECHO (task 3.5) — the read path against the
 * stub host: a seeded ledger ImageBlock renders through the authorized
 * proxy on cold load, a live send's durable twin renders after the poll
 * (replacing the optimistic bubble by (text, count)), and a ref the host
 * never stored answers with the honest failure card (BC-A5).
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const PNG_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const STUB_PORT = 4590;
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

test('01 · cold load renders the seeded ledger image through the authorized read', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();
	const gallery = page.getByTestId('message-images').filter({
		has: page.getByAltText('seeded-shot.png')
	});
	await expect(gallery.getByTestId('message-image')).toBeVisible({ timeout: 10_000 });
	// The text twin rides the same durable bubble
	const bubble = page.getByTestId('message-bubble').filter({ hasText: 'Shared a screenshot earlier' });
	await expect(bubble).toBeVisible();
	// Gallery rides ON TOP of the bubble (2026-08-28): a sibling ABOVE it —
	// never inside the bubble — separated by the column's small gap.
	expect(await bubble.getByTestId('message-images').count()).toBe(0);
	const precedesBubble = await gallery.evaluate(
		(g, b) => !!(b && g.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING),
		await bubble.elementHandle()
	);
	expect(precedesBubble).toBe(true);
	const gap = await gallery.evaluate(
		(el) => getComputedStyle(el.parentElement!.parentElement!).columnGap
	);
	expect(gap).toBe('6px');
});

test('02 · a vanished ref renders the honest failure card, never a broken img', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();
	await expect(page.getByTestId('message-image-failed')).toBeVisible({ timeout: 10_000 });
	await expect(page.getByTestId('transcript')).toContainText('This one vanished upstream');
});

test('03 · live send — the durable twin replaces the optimistic bubble and renders its image', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('prompt-textarea')).toBeVisible();

	await page.evaluate((b64: string) => {
		const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		const dt = new DataTransfer();
		dt.items.add(new File([bytes], 'echoed.png', { type: 'image/png' }));
		document
			.querySelector('[data-testid="prompt-textarea"]')
			?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
	}, PNG_B64);
	await expect(page.getByTestId('attachment-chip')).toHaveCount(1);
	await page.getByTestId('prompt-textarea').fill('echo this please');
	await page.getByTestId('send-button').click();

	// The durable twin lands via poll: its gallery renders (authorized read),
	// keyed by the echoed filename — and there is exactly ONE such gallery
	// (the optimistic bubble was consumed by (text, count) matching).
	await expect(page.getByAltText('echoed.png')).toBeVisible({ timeout: 15_000 });
	await expect(
		page.getByTestId('message-images').filter({ has: page.getByAltText('echoed.png') })
	).toHaveCount(1);
	await expect(page.getByTestId('transcript')).toContainText('The quick brown fox.');
});
