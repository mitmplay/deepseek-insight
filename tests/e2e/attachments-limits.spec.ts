/**
 * E2E: composer attachment LIMITS (task 4.3) — the host's own numbers drive
 * the UI (BC-A6): the accept attribute derives from the projection's
 * mediaTypes, and over-limit picks are refused at entry with the host's
 * numbers in an honest role=alert note.
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID, stubRuntime } from './dsh-stub';

/** 1×1 transparent PNG (~70 base64 chars, ~70 bytes decoded). */
const PNG_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A padded PNG-shaped buffer of ~2KB (over the 1KB per-image cap). */
function bigPng(): Buffer {
	return Buffer.concat([Buffer.from(PNG_B64, 'base64'), Buffer.alloc(2_000, 0x41)]);
}

const STUB_PORT = 4590;
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
	// Tight host numbers, set BEFORE navigation — the cold load's tail
	// projections bake them into the composer (BC-A6: read, don't guess).
	stubRuntime!.setImageLimits({
		maxImageBytes: 1_000,
		maxImagesPerMessage: 2,
		maxMessageImageBytes: 1_500,
		maxImagePixels: 1_000_000,
		maxImageDimension: 1_024,
		mediaTypes: ['image/png']
	});
});

test.afterAll(async () => {
	await stub?.stop();
});

async function pick(page: import('@playwright/test').Page, files: Array<{ name: string; buffer: Buffer }>): Promise<void> {
	const chooser = page.waitForEvent('filechooser');
	await page.getByTestId('attach-button').click();
	await (await chooser).setFiles(files.map((f) => ({ name: f.name, mimeType: 'image/png', buffer: f.buffer })));
}

test('01 · the accept attribute derives from the host projection mediaTypes', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('prompt-textarea')).toBeVisible();
	await expect(page.getByTestId('attach-input')).toHaveAttribute('accept', 'image/png');
});

test('02 · over-count pick refuses the batch with the host number — chips untouched', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('prompt-textarea')).toBeVisible();
	const small = { name: 'ok.png', buffer: Buffer.from(PNG_B64, 'base64') };
	await pick(page, [small, { ...small, name: 'ok2.png' }]);
	await expect(page.getByTestId('attachment-chip')).toHaveCount(2);

	await pick(page, [{ ...small, name: 'third.png' }]);
	await expect(page.getByTestId('attach-note')).toContainText('3 of 2 allowed per message');
	await expect(page.getByTestId('attachment-chip')).toHaveCount(2); // batch-loud: nothing admitted
});

test('03 · over-size pick names the file and the host cap', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('prompt-textarea')).toBeVisible();
	await pick(page, [{ name: 'huge.png', buffer: bigPng() }]);
	await expect(page.getByTestId('attach-note')).toContainText('huge.png');
	await expect(page.getByTestId('attach-note')).toContainText('1000B');
	await expect(page.getByTestId('attachment-chip')).toHaveCount(0);
});

test('04 · the drop overlay copy states the real limits', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('prompt-textarea')).toBeVisible();
	await page.evaluate(() => {
		const ev = new DragEvent('dragenter', { bubbles: true, cancelable: true });
		Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [] } });
		document.body.dispatchEvent(ev);
	});
	await expect(page.getByTestId('drop-overlay')).toBeVisible();
	await expect(page.getByTestId('drop-overlay')).toContainText('up to 2');
	await expect(page.getByTestId('drop-overlay')).toContainText('1000B each');
});
