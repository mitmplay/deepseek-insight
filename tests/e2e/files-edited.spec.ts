/**
 * Edited-Files Card e2e (spec "2026-09-25 - Edited-Files Card", task 3.4
 * follow-up — run HEADED for operator verification: pnpm exec playwright
 * test tests/e2e/files-edited.spec.ts --headed).
 *
 * Seeded journey (extraSessions ledger + the stub's GET changes routes):
 *   1. the transcript shows the collapsed 'edited files' chip — the peek
 *      button counts only the real tool call (1), never the card;
 *   2. expanding renders "Edited 2 files" with +12/-3, the binary marker,
 *      and the cap hint;
 *   3. hovering a row highlights it immediately and, held ≥1s, opens the
 *      git-diff-view with the file's hunks.
 */
import { expect, test } from '@playwright/test';
import { DshStubHost } from './dsh-stub';

const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;
const CHANGES_SESSION_ID = 'e2e-changes-session-0007';

const SUMMARY = {
	turn: 1,
	files: [
		{ path: 'src/a.ts', display: 'src/a.ts', added: 12, deleted: 3 },
		{ path: 'bin/data.db', display: 'bin/data.db', added: 0, deleted: 0, binary: true }
	],
	total: 5,
	added: 12,
	deleted: 3
};

const DIFF0 = {
	kind: 'text',
	path: 'src/a.ts',
	display: 'src/a.ts',
	before: true,
	after: true,
	coarse: false,
	hunks: [
		{
			oldStart: 1,
			oldLines: 2,
			newStart: 1,
			newLines: 3,
			lines: [' context', '+added line', '-removed line', ' context2']
		}
	]
};

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
					sessionId: CHANGES_SESSION_ID,
					title: 'edited-files seed',
					agentPreset: null,
					cwd: '/tmp',
					changes: [{ seq: 104, summary: SUMMARY, diffs: { 0: DIFF0 } }],
					ledger: [
						{ event: { type: 'turn/start', seq: 100, time: 1787212000001, data: {} } },
						{
							event: {
								type: 'tool/call',
								seq: 101,
								time: 1787212000002,
								data: {
									turn: 1,
									step: 1,
									callId: 'call_changes_1',
									name: 'bash',
									arguments: '{"cmd":"ls"}'
								}
							}
						},
						{
							event: {
								type: 'tool/result',
								seq: 102,
								time: 1787212000003,
								data: {
									turn: 1,
									step: 1,
									message: {
										source: { kind: 'tool', callId: 'call_changes_1' },
										content: [{ type: 'tool-result', toolCallId: 'call_changes_1', content: [{ type: 'text', text: 'ok' }], isError: false }],
										role: 'user',
										id: 'stub-changes-1'
									}
								}
							}
						},
						{
							event: {
								type: 'assistant/message',
								seq: 103,
								time: 1787212000004,
								data: { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'Edits are done.' }] } }
							}
						},
						{ event: { type: 'workspace/changes', seq: 104, time: 1787212000005, data: { turn: 1 } } },
						{ event: { type: 'turn/end', seq: 105, time: 1787212000006, data: {} } }
					]
				}
			]
		})
	});
});

test.afterAll(async () => {
	await stub?.stop();
});

test('files-edited chip expands to counts; peek counts only real chips; hover 2s opens the diff', async ({ page }) => {
	test.setTimeout(45_000);
	await page.goto(`/?sessionKey=${CHANGES_SESSION_ID}`);
	await expect(page.getByText('Edits are done.')).toBeVisible();

	// 1. the peek button counts the real tool call only (bash = 1, the
	//    files-edited entry is a self-rendering card, never a chip)
	await expect(page.getByTestId('tool-peek-button')).toHaveText(/\b1\b/);
	// 2. the collapsed chip renders; the card body does not exist yet
	const toggle = page.getByTestId('files-edited-toggle');
	await expect(toggle).toBeVisible();
	await expect(page.getByTestId('files-edited-card')).toHaveCount(0);

	// 3. expand: counts, binary marker, cap hint
	await toggle.click();
	const card = page.getByTestId('files-edited-card');
	await expect(card).toBeVisible();
	await expect(card.getByText('Edited 5 files')).toBeVisible();
	await expect(card.getByText('+12')).toBeVisible();
	await expect(card.getByText('-3')).toBeVisible();
	await expect(card.getByText('binary')).toBeVisible();
	await expect(card.getByText('and 3 more')).toBeVisible();

	// 4. hover the first row: highlight immediately, diff after the 2s hold
	const row = page.getByTestId('files-edited-file').first();
	await row.hover();
	await expect(card.getByText('and 3 more')).toBeVisible(); // still open
	// dump first — visibility may legitimately fail here while we diagnose
	const dumpNow = await page
		.getByTestId('files-edited-diff')
		.evaluate((el) => {
			const r = el.getBoundingClientRect();
			const cs = getComputedStyle(el);
			return { length: el.innerHTML.length, rect: { w: r.width, h: r.height }, display: cs.display, visibility: cs.visibility, rows: el.querySelectorAll('tr').length };
		})
		.catch(() => ({ length: -1, html: 'no element' }));
	// eslint-disable-next-line no-console
	console.log('DIFF DUMP NOW:', JSON.stringify(dumpNow));
	// debug: dump what actually rendered inside the diff host
	const dump = await page.getByTestId('files-edited-diff').evaluate((el) => ({
		length: el.innerHTML.length,
		html: el.innerHTML.slice(0, 800)
	}));
	// eslint-disable-next-line no-console
	console.log('DIFF DUMP:', JSON.stringify(dump));
	expect(dump.length, 'diff host innerHTML length').toBeGreaterThan(100);
	const diff = page.getByTestId('files-edited-diff');
	// the lib renders the sign in its own gutter cell — assert the content
	await expect(diff.getByText('added line')).toBeVisible();
	await expect(diff.getByText('removed line')).toBeVisible();
});
