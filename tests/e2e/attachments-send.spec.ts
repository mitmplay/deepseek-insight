/**
 * E2E: composer attachment SEND (task 2.5) — the Wave 2 wire against the
 * stub host: a text+image send crosses as ordered content (recorded in
 * promptCalls), an attachments-only send passes with empty text, and an
 * over-limit image is refused by the host admission — the composer note
 * answers and the drafts SURVIVE (BC-A3, the honest rejection).
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

/** 1×1 transparent PNG — decodable, ~96 base64 chars, well under the limit. */
const PNG_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

async function pasteImage(page: import('@playwright/test').Page, name: string, b64 = PNG_B64): Promise<void> {
	await page.evaluate(
		({ b64, name }) => {
			const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			const dt = new DataTransfer();
			dt.items.add(new File([bytes], name, { type: 'image/png' }));
			document
				.querySelector('[data-testid="prompt-textarea"]')
				?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
		},
		{ b64, name }
	);
	await expect(page.getByTestId('attachment-chip')).toHaveCount(1);
}

test('01 · text+image send crosses as ordered content — chips clear, turn streams', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('prompt-textarea')).toBeVisible();
	await pasteImage(page, 'with-note.png');
	await page.getByTestId('prompt-textarea').fill('Playwright test prompt');
	await page.getByTestId('send-button').click();
	// Drafts cleared on admission (BC-A4)
	await expect(page.getByTestId('attachment-chip')).toHaveCount(0);
	// The scripted turn streams (the text part drives the scenario) — the
	// prompt-triggered scenario finalizes with its own reply (stub:374)
	await expect(page.getByTestId('transcript')).toContainText('The quick brown fox.', {
		timeout: 15_000
	});
	// Wire truth: the stub recorded ONE prompt carrying ONE image part
	const state = await (await fetch(`${stubCtl}`)).json();
	const call = state.promptCalls.at(-1);
	expect(call.text).toBe('Playwright test prompt');
	expect(call.imageCount).toBe(1);
	expect(call.imageMediaTypes).toEqual(['image/png']);
});

test('02 · attachments-only send passes with empty text', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('prompt-textarea')).toBeVisible();
	await pasteImage(page, 'only.png');
	await page.getByTestId('send-button').click();
	await expect(page.getByTestId('attachment-chip')).toHaveCount(0);
	const state = await (await fetch(`${stubCtl}`)).json();
	const call = state.promptCalls.at(-1);
	expect(call.text).toBe('');
	expect(call.imageCount).toBe(1);
});

test('03 · over-limit image — host refuses, composer note answers, drafts SURVIVE (BC-A3)', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('prompt-textarea')).toBeVisible();
	// A padded buffer well past the stub's admission limit
	await pasteImage(page, 'big.png', Buffer.from(new Uint8Array(9_000).fill(0x41)).toString('base64'));
	await page.getByTestId('prompt-textarea').fill('too big');
	await page.getByTestId('send-button').click();
	// The host's refusal answers AT THE COMPOSER with its own words (the
	// drafts it rejected are still attached right there); the transcript-
	// top banner stays empty — one home per error (2026-08-26).
	await expect(page.getByTestId('composer-error')).toContainText('image exceeds limit');
	await expect(page.getByTestId('conversation-error')).toHaveCount(0);
	// The draft is STILL THERE — nothing was lost (BC-A3)
	await expect(page.getByTestId('attachment-chip')).toHaveCount(1);
	await expect(page.getByTestId('attachment-chip-thumb')).toHaveAttribute('alt', 'big.png');
});
