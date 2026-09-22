// @vitest-environment node
/**
 * GET /api/config — the collapseHome security branch (lines 31-36): the wire
 * carries `~/…`, never the absolute homedir. resolvePromptsDbPath is mocked
 * to a controllable seam so each collapseHome arm is pinned deterministically
 * (exact home → '~', home-prefixed → '~/…', unrelated path → verbatim).
 * Sections themselves are pinned by tests/unit/config-route.test.ts.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbPathState = vi.hoisted(() => ({ value: '' }));

vi.mock('$lib/server/prompts/db.js', () => ({
	resolvePromptsDbPath: () => dbPathState.value
}));

import { GET } from '../../src/routes/api/config/+server';

const getBody = async () => {
	const res = await GET(new Request('http://dsi/api/config') as unknown as Parameters<typeof GET>[0]);
	expect(res.status).toBe(200);
	return (await res.json()) as { prompts: { dbPath: string } };
};

beforeEach(() => {
	dbPathState.value = '';
});

describe('GET /api/config prompts.dbPath tilde-collapse', () => {
	it('collapses the bare homedir back to ~', async () => {
		dbPathState.value = homedir();
		const body = await getBody();
		expect(body.prompts.dbPath).toBe('~');
	});

	it('collapses a home-prefixed path to ~/…', async () => {
		dbPathState.value = join(homedir(), 'library/prompts.sqlite');
		const body = await getBody();
		expect(body.prompts.dbPath).toBe('~/library/prompts.sqlite');
	});

	it('leaves a path outside home verbatim (the browser may see /opt)', async () => {
		dbPathState.value = '/var/lib/dsi/prompts.sqlite';
		const body = await getBody();
		expect(body.prompts.dbPath).toBe('/var/lib/dsi/prompts.sqlite');
	});
});
