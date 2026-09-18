/**
 * E2E: the workspace chip menu (Chip Menu ADR, 2026-09-05) — Rename and
 * Delete from the collapsed filter header's workspace chip, over the
 * same stub-host setup as sidebar.spec.ts (no live dsh web needed).
 *
 * Contract under test:
 *   1. registered chip click opens the menu WITHOUT folding the pills;
 *      Escape closes (ADR D1)
 *   2. rename relabels the chip from the registry TITLE after the
 *      follow-stream settle (ADR D5/D6 — no optimistic mutation)
 *   3. a name-conflict refusal renders inline, verbatim code (ADR D2/D3)
 *   4. delete: the honest cost copy shows BEFORE the confirming click;
 *      after delete the chip turns ghost, its sessions survive (ADR D2)
 *   5. a ghost chip click folds the pills and never opens a menu (D1/D4)
 */

import { expect, test, type Page } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

// 4590 is the shared preview-server DSH_BASE_URL (playwright.config); every
// spec file re-seeds its own stub there (workers: 1 — serial files).
const STUB_PORT = 4590;

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

/** The row's prelude: ensure the pills render (expanded is the load
 *  default), pick a workspace pill, so the summary chip names exactly
 *  that workspace. */
async function filterToWorkspace(page: Page, pill: string): Promise<void> {
	const toggle = page.getByTestId('filter-toggle');
	if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
	await expect(page.getByTestId('filter-all')).toBeVisible();
	await page.getByTestId(pill).click();
	await expect(page.getByTestId('filter-summary-chip-ws')).toBeVisible();
}

const chip = (page: Page) => page.getByTestId('filter-summary-chip-ws');
const chipLabel = (page: Page) => page.getByTestId('filter-summary-chip-ws').locator('.chip-label');
const menu = (page: Page) => page.getByTestId('workspace-actions-menu');

test('01 · registered chip click opens the menu and does NOT fold the pills (ADR D1)', async ({ page }) => {
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	await filterToWorkspace(page, 'filter-workspace-deepseek-harness');

	await chip(page).click();
	await expect(menu(page)).toBeVisible();
	// The gesture did not fold: the pills group stays rendered and the
	// head stays expanded.
	await expect(page.getByTestId('filter-all')).toBeVisible();
	await expect(page.getByTestId('filter-toggle')).toHaveAttribute('aria-expanded', 'true');

	// Escape closes.
	await page.keyboard.press('Escape');
	await expect(menu(page)).toHaveCount(0);
});

test('02 · rename relabels the chip from the registry title after the settle (ADR D5/D6)', async ({ page }) => {
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	await filterToWorkspace(page, 'filter-workspace-deepseek-harness');

	await chip(page).click();
	await page.getByTestId('workspace-action-rename').click();
	const input = page.getByTestId('workspace-rename-input');
	await expect(input).toHaveValue('deepseek-harness');
	await input.fill('Renamed Harness');
	await page.getByTestId('workspace-rename-confirm').click();
	// No optimistic relabel: the menu closes and the chip still shows the
	// old label until the follow-stream settle + spine poll re-derive it.
	await expect(menu(page)).toHaveCount(0);
	await expect.poll(async () => (await chipLabel(page).textContent()) ?? '', { timeout: 15_000 })
		.toBe('Renamed Harness');
	// The old-basename pill is gone (title-first labels, wave 3).
	await expect(page.getByTestId('filter-workspace-deepseek-harness')).toHaveCount(0);

	// The stub recorded the receipt.
	const state = await (await fetch('http://127.0.0.1:' + STUB_PORT + '/__e2e/state')).json() as { workspaceRenameCalls: Array<{ workspaceId: string; title: string }> };
	expect(state.workspaceRenameCalls.at(-1)).toEqual({ workspaceId: 'ws-stub-harness', title: 'Renamed Harness' });
});

test('03 · a name-conflict refusal renders inline, code verbatim, menu stays open (ADR D2/D3)', async ({ page }) => {
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	// Test 02 renamed harness — its pill now carries the registry title
	// (title-first labels): the rename is visible here too.
	await filterToWorkspace(page, 'filter-workspace-Renamed Harness');

	await chip(page).click();
	await page.getByTestId('workspace-action-rename').click();
	await page.getByTestId('workspace-rename-input').fill('deepseek-chat');
	await page.getByTestId('workspace-rename-confirm').click();
	await expect(page.getByTestId('workspace-menu-error')).toContainText('workspace/name-conflict');
	await expect(menu(page)).toBeVisible();
});

test('04 · delete shows the honest cost first, then the chip goes ghost with sessions intact (ADR D2)', async ({ page }) => {
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	await filterToWorkspace(page, 'filter-workspace-deepseek-chat');

	await chip(page).click();
	await page.getByTestId('workspace-action-delete').click();
	// The cost copy states the semantics BEFORE the click is spent.
	await expect(page.getByTestId('workspace-delete-cost')).toContainText('sessions stay');
	await page.getByTestId('workspace-delete-confirm').click();
	await expect(menu(page)).toHaveCount(0);

	// The chip turns ghost: grey class + the registry-suffix tooltip.
	await expect.poll(async () => (await chip(page).getAttribute('title')) ?? '', { timeout: 15_000 })
		.toContain('not in the workspace registry');
	await expect(chip(page)).toHaveClass(/ghost/);

	// Sessions survive: the spine still lists the chat session (its cwd
	// persists even though the registry row is gone — hybrid truth).
	await expect(page.getByText('Chat side session')).toBeVisible();
});

test('05 · the popup paints ABOVE the session rows it covers (2026-09-05 SessionStatus-overlap fix)', async ({ page }) => {
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	// Works whether or not 02's rename ran (isolated -g runs see the
	// original basename pill; full-file runs see the renamed title).
	const pill = page.locator('[data-testid="filter-workspace-deepseek-harness"], [data-testid="filter-workspace-Renamed Harness"]').first();
	{
		const t = page.getByTestId('filter-toggle');
		if ((await t.getAttribute('aria-expanded')) === 'false') await t.click();
	}
	await expect(page.getByTestId('filter-all')).toBeVisible();
	await pill.click();
	await expect(page.getByTestId('filter-summary-chip-ws')).toBeVisible();
	// Collapse the pills back — the live repro's layout.
	await page.getByTestId('filter-toggle').click();
	await chip(page).click();
	await expect(menu(page)).toBeVisible();
	// The popup's stacking is owned by the POSITIONED anchor: the menu
	// element itself is position:static, where z-index is IGNORED — the
	// 2026-09-05 overlap put z-index:40 on the menu and the spine rows'
	// positioned .status glyphs painted over the popup in DOM order. Pin
	// the invariant that regressed. (A full elementFromPoint-over-glyph
	// proof needs the live app's crowded-rail geometry — reproduced and
	// verified there 2026-09-05; this stub fixture's rows never crowd
	// under the header, viewport and scroll nudges included.)
	const paint = await page.evaluate(() => {
		const menu = document.querySelector('[data-testid="workspace-actions-menu"]') as HTMLElement;
		const anchor = menu.closest('.menu-anchor') as HTMLElement;
		const mr = menu.getBoundingClientRect();
		const hit = document.elementFromPoint(mr.left + mr.width / 2, mr.top + mr.height / 2);
		return {
			anchorZ: getComputedStyle(anchor).zIndex,
			anchorPos: getComputedStyle(anchor).position,
			menuZIgnored: getComputedStyle(menu).zIndex === 'auto',
			menuOwnsItsPoint: !!(hit && menu.contains(hit))
		};
	});
	expect(paint.anchorPos).toBe('absolute');
	expect(paint.anchorZ).toBe('40');
	expect(paint.menuZIgnored).toBe(true);
	expect(paint.menuOwnsItsPoint).toBe(true);
});

test('06 · a ghost chip click folds the pills and never opens a menu (ADR D1/D4)', async ({ page }) => {
	// Self-sufficient (a failing sibling test restarts the worker, whose
	// beforeAll re-seeds a FRESH stub — never depend on 04's mutation):
	// delete deepseek-chat here UNLESS 04 already did (same worker keeps
	// one stub — a second delete refuses workspace/not-found).
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	await filterToWorkspace(page, 'filter-workspace-deepseek-chat');
	if (!/ghost/.test((await chip(page).getAttribute('class')) ?? '')) {
		await chip(page).click();
		await page.getByTestId('workspace-action-delete').click();
		await page.getByTestId('workspace-delete-confirm').click();
		await expect(menu(page)).toHaveCount(0);
	}
	// The chip is (or turns) ghost after the settle.
	await expect.poll(async () => (await chip(page).getAttribute('title')) ?? '', { timeout: 15_000 })
		.toContain('not in the workspace registry');

	// Ghost styling — polled: a fresh page's first spine poll can predate
	// the follow-stream settle, so the chip may start menuable briefly.
	await expect.poll(async () => (await chip(page).getAttribute('class')) ?? '', { timeout: 15_000 }).toMatch(/ghost/);
	await chip(page).click();
	await expect(menu(page)).toHaveCount(0);
	// The bubble reached the fold: pills collapsed.
	await expect(page.getByTestId('filter-toggle')).toHaveAttribute('aria-expanded', 'false');
});
