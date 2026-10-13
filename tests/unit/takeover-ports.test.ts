/**
 * takeover-ports — the takeover sweep orchestrator (The Port Takeover ADR
 * 2026-10-12, D2/D3/D5): SIGTERM listeners with receipts, wait bounded for
 * the ports to actually free, honest failure naming port and holder. Pure
 * module — every effect is injected, so these tests never touch a socket.
 */
import { describe, expect, it, vi } from 'vitest';
import { takeoverFloorPorts, TAKEOVER_BUDGET_MS, TAKEOVER_POLL_MS } from '../../bin/lib/plugin-chain.mjs';

interface EffectRecorder {
	listeners: Record<number, number[]>;
	terminated: number[];
	logs: string[];
	free: (port: number) => boolean;
	ticks: number;
}

function makeEffects(rec: EffectRecorder) {
	return {
		listListeners: (port: number) => rec.listeners[port] ?? [],
		terminate: (pid: number) => { rec.terminated.push(pid); },
		portFree: (port: number) => rec.free(port),
		sleep: (ms: number) => {
			rec.ticks += ms;
			return Promise.resolve();
		},
		now: () => rec.ticks,
		log: (line: string) => { rec.logs.push(line); }
	};
}

describe('takeoverFloorPorts', () => {
	it('D5: emits a receipt line per terminated listener', async () => {
		const rec: EffectRecorder = { listeners: { 3080: [904], 5174: [], 5175: [904] }, terminated: [], logs: [], free: () => true, ticks: 0 };
		const result = await takeoverFloorPorts([3080, 5174, 5175], makeEffects(rec));
		expect(result.ok).toBe(true);
		expect(rec.terminated).toEqual([904, 904]);
		expect(rec.logs.filter((l) => l.startsWith('takeover: SIGTERM pid 904'))).toHaveLength(2);
	});

	it('D3: ports already free wait zero and report freed immediately', async () => {
		const rec: EffectRecorder = { listeners: {}, terminated: [], logs: [], free: () => true, ticks: 0 };
		const result = await takeoverFloorPorts([3080], makeEffects(rec));
		expect(result.ok).toBe(true);
		expect(rec.ticks).toBe(0);
		expect(rec.logs.some((l) => l.includes('port 3080 free after 0ms'))).toBe(true);
	});

	it('D3: polls at the 250ms cadence until a dying port frees', async () => {
		let polls = 0;
		const rec: EffectRecorder = { listeners: { 3080: [275] }, terminated: [], logs: [], free: () => ++polls >= 3, ticks: 0 };
		const result = await takeoverFloorPorts([3080], makeEffects(rec));
		expect(result.ok).toBe(true);
		expect(rec.terminated).toEqual([275]);
		expect(rec.ticks).toBe(2 * TAKEOVER_POLL_MS);
		expect(rec.logs.some((l) => l.includes('port 3080 free after'))).toBe(true);
	});

	it('D3: a port never freed gives up at the budget, naming port and holder', async () => {
		const rec: EffectRecorder = { listeners: { 3080: [999] }, terminated: [], logs: [], free: () => false, ticks: 0 };
		const result = await takeoverFloorPorts([3080], makeEffects(rec));
		expect(result.ok).toBe(false);
		expect(result.port).toBe(3080);
		expect(result.pid).toBe(999);
		expect(rec.logs.some((l) => l.includes('port 3080 still held by pid 999'))).toBe(true);
		// now() advances only via sleep; the budget was honored
		expect(rec.ticks).toBeLessThanOrEqual(TAKEOVER_BUDGET_MS + TAKEOVER_POLL_MS);
	});

	it('D2: never signals a pid beyond the listed listeners', async () => {
		const rec: EffectRecorder = { listeners: { 3080: [111] }, terminated: [], logs: [], free: () => true, ticks: 0 };
		await takeoverFloorPorts([3080, 5174, 5175], makeEffects(rec));
		expect(rec.terminated).toEqual([111]);
	});
});
