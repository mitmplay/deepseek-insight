// Rack server-wrapper tests (Task 1.2-T) — stubbed runner, no real engine child.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import {
	defaultEnginePath,
	getRackEngine,
	setRackEngineRunner
} from '../../../../src/lib/server/plugins/engine'
import {
	RackEngineFailedError,
	RackEngineMissingError,
	type RackEnginePayload
} from '../../../../src/lib/server/plugins/types'

afterEach(() => setRackEngineRunner(null))

function stub(payload: Partial<RackEnginePayload> | 'nonjson' | 'throw', opts: { wire?: number } = {}) {
	setRackEngineRunner(async () => {
		if (payload === 'nonjson') return 'not json at all'
		if (payload === 'throw') throw new Error('spawn exploded')
		return JSON.stringify({ v: opts.wire ?? 1, ok: true, ...payload })
	})
}

describe('rack engine wrapper', () => {
	it('defaultEnginePath honours RACK_ENGINE_PATH then the home mirror', () => {
		process.env.RACK_ENGINE_PATH = '/custom/rack.mjs'
		expect(defaultEnginePath()).toBe('/custom/rack.mjs')
		delete process.env.RACK_ENGINE_PATH
		expect(defaultEnginePath()).toBe(join(homedir(), '.agents/skills/dsi-plugin-rack/rack.mjs'))
	})

	it('snapshotStatus maps present through', async () => {
		stub({ present: true })
		expect(await getRackEngine().snapshotStatus()).toEqual({ present: true })
	})

	it('refresh returns the snapshot with reused flag', async () => {
		stub({ snapshot: { v: 1, generatedAt: 't', profile: 'web', plugins: [] }, reused: true })
		const r = await getRackEngine().refresh(false)
		expect(r.reused).toBe(true)
		expect(r.snapshot.profile).toBe('web')
	})

	it('refresh --reload carries the flag through to the engine args', async () => {
		const seen: string[][] = []
		setRackEngineRunner(async (_p, args) => {
			seen.push(args)
			return JSON.stringify({ v: 1, ok: true, snapshot: { v: 1, generatedAt: 't', profile: 'web', plugins: [] } })
		})
		await getRackEngine().refresh(true)
		expect(seen[0]).toContain('--reload')
	})

	it('apply resolves results and rejects without them', async () => {
		stub({ results: [{ id: 'x', ok: true }] })
		expect(await getRackEngine().apply('install', ['x'])).toEqual([{ id: 'x', ok: true }])
		stub({})
		await expect(getRackEngine().apply('remove', ['x'])).rejects.toBeInstanceOf(RackEngineFailedError)
	})

	it('non-JSON output -> RackEngineFailedError', async () => {
		stub('nonjson')
		await expect(getRackEngine().snapshotStatus()).rejects.toBeInstanceOf(RackEngineFailedError)
	})

	it('wire version mismatch -> RackEngineFailedError', async () => {
		stub({ present: false }, { wire: 2 })
		await expect(getRackEngine().snapshotStatus()).rejects.toThrow(/wire version mismatch/)
	})

	it('runner throw -> RackEngineFailedError wrapping the cause', async () => {
		stub('throw')
		await expect(getRackEngine().snapshotStatus()).rejects.toThrow(/spawn exploded/)
	})

	it('missing engine file -> RackEngineMissingError without calling the runner', async () => {
		process.env.RACK_ENGINE_PATH = '/no/such/rack.mjs'
		let called = false
		setRackEngineRunner(async () => { called = true; return '{}' })
		await expect(getRackEngine().snapshotStatus()).rejects.toBeInstanceOf(RackEngineMissingError)
		expect(called).toBe(false)
		delete process.env.RACK_ENGINE_PATH
	})
})
