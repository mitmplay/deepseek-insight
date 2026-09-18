
/**
 * E2E: DSI Canvas Copy Opaque Backing (Wave 2 task 2.1) — the pixel-space
 * pin for The Opaque Backing ADR (2026-09-07, D1/D4). The unit suite proves
 * the WIRING (the opaque constant reaches the html-to-image options); this
 * spec proves the ARTIFACT: the clipboard PNG's interior is fully opaque
 * (alpha 255) and still carries the bubble's blue tint over the floor —
 * the two things the pre-fix artifact lost (interior alpha 27-42 percent).
 *
 * Journey: open the stub session (the ledger cold-loads a real user bubble)
 * → hover → click the capture button → wait for the done icon (the
 * clipboard write has settled) → read the image/png item back from the
 * clipboard and audit pixels in ONE evaluate pass.
 *
 * Sampling discipline (session lesson, 2026-09-07): interior points only —
 * the px-4 padding strip is left of every glyph and clear of the rounded
 * corner clip zones. The done-icon wait removes the write/read race.
 *
 * Why not happy-dom: no canvas rasterizer — only a real browser can see
 * alpha. Why not PNG-byte snapshots: bytes vary per browser build; pixels
 * are the contract.
 */

import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID, STUB_USER_HELLO } from './dsh-stub';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const STUB_PORT = 4590;

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

test('the captured bubble PNG is fully opaque and keeps its tint (Opaque Backing ADR D1)', async ({
	page
}) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const transcript = page.getByTestId('transcript');
	const bubble = transcript
		.locator('[data-testid="message-bubble"][data-role="user"]', { hasText: STUB_USER_HELLO })
		.first();
	await expect(bubble).toBeVisible();

	// Hover-reveal family: the action row rides the bubble's group hover.
	await bubble.hover();
	const capture = bubble.getByTestId('canvas-copy-button');
	await expect(capture).toBeAttached();
	await capture.click();

	// done = the clipboard write has resolved (state flips after the await).
	await expect(capture.locator('svg.text-green-500')).toBeVisible();

	const audit = await page.evaluate(async () => {
		const items = await navigator.clipboard.read();
		let png: Blob | null = null;
		for (const item of items) {
			if (item.types.includes('image/png')) png = await item.getType('image/png');
		}
		if (!png) return { error: 'no image/png item on the clipboard' as const };
		const url = URL.createObjectURL(png);
		try {
			const img = new Image();
			await new Promise((res, rej) => {
				img.onload = res;
				img.onerror = () => rej(new Error('clipboard PNG did not decode'));
				img.src = url;
			});
			const c = document.createElement('canvas');
			c.width = img.width;
			c.height = img.height;
			const ctx = c.getContext('2d');
			if (!ctx) return { error: 'no 2d context' as const };
			ctx.drawImage(img, 0, 0);
			const d = ctx.getImageData(0, 0, c.width, c.height).data;
			const px = (x: number, y: number): [number, number, number, number] => {
				const i = (y * c.width + x) * 4;
				return [d[i], d[i + 1], d[i + 2], d[i + 3]];
			};
			const h = c.height;
			const w = c.width;
			// Interior strip: 16-24 device px from the left edge (8-12 CSS px,
			// inside px-4 padding, right of the 1px border, clear of corners).
			const strip = [0.25, 0.4, 0.5, 0.6, 0.75].map((fy) => px(20, Math.floor(h * fy)));
			// A dark text glyph must exist somewhere (alpha 255, near-black).
			let glyph: [number, number, number, number] | null = null;
			for (let y = 0; y < h && !glyph; y += 2) {
				for (let x = Math.floor(w * 0.25); x < w * 0.75; x += 2) {
					const p = px(x, y);
					if (p[3] === 255 && p[0] < 90 && p[1] < 90 && p[2] < 90) {
						glyph = p;
						break;
					}
				}
			}
			// Tint presence: a blue-leaning interior pixel distinct from the
			// bare floor (248, 249, 250).
			let tinted: [number, number, number, number] | null = null;
			for (let y = 4; y < h - 4 && !tinted; y += 3) {
				for (let x = 12; x < w - 12; x += 3) {
					const p = px(x, y);
					if (p[3] === 255 && p[2] - p[0] >= 15 && !(p[0] > 244 && p[1] > 245)) {
						tinted = p;
						break;
					}
				}
			}
			// Right-edge border scan (Opaque Backing Wave 2 addendum): the
			// bubble's own right border must land at the artifact's right
			// edge — a clone re-clamped by a percentage max-width shrinks
			// the border box and leaves bare floor in the last columns.
			let rightBorder: [number, number, number, number] | null = null;
			for (let y = Math.floor(h * 0.3); y < Math.floor(h * 0.7); y += 2) {
				for (let x = w - 6; x < w - 1; x++) {
					const p = px(x, y);
					if (p[3] === 255 && p[2] - p[0] >= 10) {
						rightBorder = p;
						break;
					}
				}
				if (rightBorder) break;
			}
			const rightFloor = px(w - 3, Math.floor(h * 0.5));
			return {
				size: [c.width, c.height] as [number, number],
				strip,
				glyph,
				tinted,
				rightBorder,
				rightFloor
			};
		} finally {
			URL.revokeObjectURL(url);
		}
	});

	expect(audit).not.toHaveProperty('error');
	const a = audit as {
		size: [number, number];
		strip: Array<[number, number, number, number]>;
		glyph: [number, number, number, number] | null;
		tinted: [number, number, number, number] | null;
		rightBorder: [number, number, number, number] | null;
		rightFloor: [number, number, number, number];
	};
	expect(a.size[0]).toBeGreaterThan(100);
	expect(a.size[1]).toBeGreaterThan(60);
	// THE contract: the artifact is self-contained — interior fully opaque.
	for (const p of a.strip) expect(p[3]).toBe(255);
	// The skin survived: blue tint over the floor, not a bare #f8f9fa wash.
	expect(a.tinted).not.toBeNull();
	if (a.tinted) {
		expect(a.tinted[3]).toBe(255);
		expect(a.tinted[2]).toBeGreaterThan(a.tinted[0]); // blue-leaning
	}
	// Text still renders dark and solid on top of the opaque floor.
	expect(a.glyph).not.toBeNull();
	if (a.glyph) expect(a.glyph[3]).toBe(255);
	// The border owns the FULL artifact width: the bubble's right border
	// sits in the last columns (a percentage max-width re-applied inside
	// the foreignObject shrinks the border box and strands bare floor).
	expect(a.rightBorder).not.toBeNull();
	if (a.rightBorder) {
		expect(a.rightBorder[3]).toBe(255);
		expect(a.rightBorder[2]).toBeGreaterThan(a.rightBorder[0]); // blue-leaning
	}
	// (rightFloor is sampled above for debugging; the border contract is rightBorder.)
});
