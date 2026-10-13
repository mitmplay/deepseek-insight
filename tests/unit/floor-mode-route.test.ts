import { describe, it, expect, beforeEach } from 'vitest';

// GET /api/floor/mode — the dev gate the RestartButton reads (2026-10-13):
// dev=true only when the launcher-stamped DSI_DEV=1 marker is in the env.
import { GET } from '../../src/routes/api/floor/mode/+server.ts';

describe('GET /api/floor/mode', () => {
	const saved = { dev: process.env.DSI_DEV, mode: process.env.DSI_DEV_MODE };
	beforeEach(() => {
		if (saved.dev === undefined) delete process.env.DSI_DEV;
		else process.env.DSI_DEV = saved.dev;
		if (saved.mode === undefined) delete process.env.DSI_DEV_MODE;
		else process.env.DSI_DEV_MODE = saved.mode;
	});

	it('a dev floor answers { dev: true, mode } from the launcher marker', async () => {
		process.env.DSI_DEV = '1';
		process.env.DSI_DEV_MODE = 'in-process';
		const res = await GET({} as never);
		expect(await res.json()).toEqual({ dev: true, mode: 'in-process' });
	});

	it('a dev floor without a mode enum falls back to "dev"', async () => {
		process.env.DSI_DEV = '1';
		delete process.env.DSI_DEV_MODE;
		const res = await GET({} as never);
		expect(await res.json()).toEqual({ dev: true, mode: 'dev' });
	});

	it('a build floor (no marker) answers { dev: false, mode: "build" }', async () => {
		delete process.env.DSI_DEV;
		const res = await GET({} as never);
		expect(await res.json()).toEqual({ dev: false, mode: 'build' });
	});
});
