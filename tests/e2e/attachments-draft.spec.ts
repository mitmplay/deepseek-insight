/**
 * E2E: composer attachment drafts (task 1.6) — the Wave 1 surface against
 * the stubbed DSH wire: pick via file chooser, chip remove by id, paste into
 * the textarea, and the document drop overlay. No wire bytes change (W1 is
 * browser-local by contract); the stub only hosts the session page.
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

/** 1x1 transparent PNG — a real decodable image, not just bytes. */
const PNG_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function pngBuffer(): Buffer {
	return Buffer.from(PNG_B64, 'base64');
}

const STUB_PORT = 4590;
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

test.beforeEach(async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('prompt-textarea')).toBeVisible();
});

test('01 · pick via file chooser renders one chip per image', async ({ page }) => {
	const chooser = page.waitForEvent('filechooser');
	await page.getByTestId('attach-button').click();
	await (await chooser).setFiles([
		{ name: 'shot-one.png', mimeType: 'image/png', buffer: pngBuffer() },
		{ name: 'shot-two.png', mimeType: 'image/png', buffer: pngBuffer() }
	]);
	await expect(page.getByTestId('attachment-chip')).toHaveCount(2);
	// The file name survives only as the thumb alt (DSH rail shape — no label).
	await expect(page.getByTestId('attachment-chip-thumb').first()).toHaveAttribute('alt', 'shot-one.png');
});

test('02 · chip remove drops exactly that draft', async ({ page }) => {
	const chooser = page.waitForEvent('filechooser');
	await page.getByTestId('attach-button').click();
	await (await chooser).setFiles([
		{ name: 'keep.png', mimeType: 'image/png', buffer: pngBuffer() },
		{ name: 'gone.png', mimeType: 'image/png', buffer: pngBuffer() }
	]);
	await expect(page.getByTestId('attachment-chip')).toHaveCount(2);
	await page.getByRole('button', { name: 'Remove attachment gone.png' }).click();
	await expect(page.getByTestId('attachment-chip')).toHaveCount(1);
	await expect(page.getByTestId('attachment-chip-thumb')).toHaveAttribute('alt', 'keep.png');
});

test('03 · paste into the textarea admits an image and enables Send with empty text', async ({ page }) => {
	await expect(page.getByTestId('send-button')).toBeDisabled();
	await page.evaluate((b64: string) => {
		const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		const dt = new DataTransfer();
		dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
		document
			.querySelector('[data-testid="prompt-textarea"]')
			?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
	}, PNG_B64);
	await expect(page.getByTestId('attachment-chip')).toHaveCount(1);
	await expect(page.getByTestId('attachment-chip-thumb')).toHaveAttribute('alt', 'pasted.png');
	await expect(page.getByTestId('send-button')).toBeEnabled();
});

test('04 · document drop overlay appears on file drags and admits dropped images', async ({ page }) => {
	await page.evaluate((b64: string) => {
		const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		const dt = new DataTransfer();
		dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
		const withTransfer = (type: string): DragEvent => {
			const ev = new DragEvent(type, { bubbles: true, cancelable: true });
			Object.defineProperty(ev, 'dataTransfer', { value: dt });
			return ev;
		};
		document.body.dispatchEvent(withTransfer('dragenter'));
		(window as unknown as { __drop: () => void }).__drop = () => {
			document.body.dispatchEvent(withTransfer('drop'));
		};
	}, PNG_B64);
	await expect(page.getByTestId('drop-overlay')).toBeVisible();
	await expect(page.getByTestId('drop-overlay')).toContainText('Drop images to attach');
	await page.evaluate(() => (window as unknown as { __drop: () => void }).__drop());
	await expect(page.getByTestId('drop-overlay')).toBeHidden();
	await expect(page.getByTestId('attachment-chip')).toHaveCount(1);
	await expect(page.getByTestId('attachment-chip-thumb')).toHaveAttribute('alt', 'dropped.png');
});

test('05 · thumbnail follows the DSH rail — 62px card, hover remove, zoom-in, lightbox', async ({
	page
}) => {
	const chooser = page.waitForEvent('filechooser');
	await page.getByTestId('attach-button').click();
	await (await chooser).setFiles([{ name: 'shot.png', mimeType: 'image/png', buffer: pngBuffer() }]);
	const chip = page.getByTestId('attachment-chip');
	await expect(chip).toHaveCount(1);

	// Geometry + invitation (DSH AttachmentRail): a 62×62 card, zoom-in
	// cursor, and the "Show original" tooltip.
	const open = page.getByTestId('attachment-chip-open');
	const box = await open.evaluate((el) => {
		const s = getComputedStyle(el);
		return { width: s.width, height: s.height, cursor: s.cursor, title: el.getAttribute('title') };
	});
	expect(box.width).toBe('62px');
	expect(box.height).toBe('62px');
	expect(box.cursor).toMatch(/^zoom/); // engines serialize zoom-in variously
	expect(box.title).toBe('Show original');

	// The remove control hides at rest and reveals on chip hover.
	const remove = page.getByTestId('attachment-chip-remove');
	const restOpacity = await remove.evaluate((el) => getComputedStyle(el).opacity);
	expect(restOpacity).toBe('0');
	await chip.hover();
	await expect(remove).toHaveCSS('opacity', '1');

	// Single click opens the ORIGINAL image in the document-level lightbox.
	await open.click();
	const lightbox = page.getByTestId('attachment-lightbox');
	await expect(lightbox).toBeVisible();
	const img = page.getByTestId('attachment-lightbox-image');
	await expect(img).toBeVisible();
	expect(await img.getAttribute('src')).toMatch(/^blob:/);

	// A press on the mask — outside the image — closes the modal.
	await page.getByTestId('attachment-lightbox-mask').click({ position: { x: 10, y: 10 } });
	await expect(lightbox).toBeHidden();
	await expect(page.getByTestId('attachment-chip')).toHaveCount(1); // draft untouched
});
