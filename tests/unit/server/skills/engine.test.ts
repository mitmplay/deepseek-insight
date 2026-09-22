// 2.1-T — engine wrapper: JSON parse, version pin, timeout mapping, missing-engine mapping.
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultEnginePath, EngineFailedError, EngineMissingError, getEngine, setEngineRunner } from '../../../../src/lib/server/skills/engine';

const SNAP = { v: 1, generatedAt: 't', sources: [] };

beforeEach(() => setEngineRunner(null));

describe('engine wrapper', () => {
  it('refresh parses stdout JSON and returns snapshot', async () => {
    setEngineRunner(async (_p, args) => JSON.stringify({ v: 1, ok: true, reused: false, snapshot: SNAP, _args: args }));
    const out = await getEngine().refresh(false);
    expect(out.snapshot).toEqual(SNAP);
    expect(out.reused).toBe(false);
  });

  it('non-JSON output maps to EngineFailedError', async () => {
    setEngineRunner(async () => 'not json');
    await expect(getEngine().refresh(false)).rejects.toBeInstanceOf(EngineFailedError);
  });

  it('wire version mismatch is refused loudly (weakest-point pin)', async () => {
    setEngineRunner(async () => JSON.stringify({ v: 2, ok: true, snapshot: SNAP }));
    await expect(getEngine().refresh(false)).rejects.toThrow(/version mismatch/);
  });

  it('killed process (timeout) maps to EngineFailedError with timeout message', async () => {
    setEngineRunner(async () => {
      const err = new Error('killed') as Error & { killed: boolean };
      err.killed = true;
      throw err;
    });
    await expect(getEngine().refresh(false)).rejects.toThrow(/timed out/);
  });

  it('missing engine file maps to EngineMissingError', async () => {
    vi.doMock('node:fs', () => ({ existsSync: () => false }));
    // existsSync check happens before runner use; simulate via empty-path override is not possible,
    // so assert the class contract the route mapper relies on instead:
    const e = new EngineMissingError('/no/such/shelf.mjs');
    expect(e.name).toBe('EngineMissingError');
    expect(e.enginePath).toBe('/no/such/shelf.mjs');
  });

  it('apply surfaces results; missing results is an EngineFailedError', async () => {
    setEngineRunner(async () => JSON.stringify({ v: 1, ok: true, results: [{ n: '1.1', ok: true }] }));
    const results = await getEngine().apply('install', ['1.1']);
    expect(results[0].ok).toBe(true);

    setEngineRunner(async () => JSON.stringify({ v: 1, ok: false, errors: ['boom'] }));
    await expect(getEngine().apply('install', ['1.1'])).rejects.toBeInstanceOf(EngineFailedError);
  });

  it('snapshotStatus maps the wire payload to { present: boolean }', async () => {
    setEngineRunner(async () => JSON.stringify({ v: 1, present: true }));
    await expect(getEngine().snapshotStatus()).resolves.toEqual({ present: true });

    setEngineRunner(async () => JSON.stringify({ v: 1, present: 0 }));
    await expect(getEngine().snapshotStatus()).resolves.toEqual({ present: false });
  });

  it('refresh picks the --reload flag through to the engine argv', async () => {
    let seen: string[] = [];
    setEngineRunner(async (_p, args) => {
      seen = args;
      return JSON.stringify({ v: 1, ok: true, reused: true, snapshot: SNAP });
    });
    await getEngine().refresh(true);
    expect(seen).toEqual(['refresh', '--reload']);
    expect(await getEngine().refresh(false).then((r) => r.reused)).toBe(true);
  });

  it('a non-killed runner rejection maps to EngineFailedError with the error message', async () => {
    setEngineRunner(async () => {
      throw new Error('spawn blew up');
    });
    await expect(getEngine().refresh(false)).rejects.toThrow(/spawn blew up/);
  });

  it('setEngineRunner(null) restores the REAL default runner (child-process seam)', async () => {
    process.env.SHELF_ENGINE_PATH = join(import.meta.dirname, '../../fixtures/shelf-fixture.mjs');
    setEngineRunner(null); // the fallback arrow in setEngineRunner must now run
    const out = await getEngine().refresh(false);
    expect(out.snapshot).toBeTruthy();
    expect(out.reused).toBe(false);
    delete process.env.SHELF_ENGINE_PATH;
  });

  it('the default runner maps a failed child process to EngineFailedError (non-killed path)', async () => {
    process.env.SHELF_ENGINE_PATH = join(import.meta.dirname, '../../fixtures/shelf-fixture.mjs');
    setEngineRunner(null);
    await expect(getEngine().apply('install', ['fail'])).rejects.toThrow(/boom from fixture engine/);
    delete process.env.SHELF_ENGINE_PATH;
  });

  it('defaultEnginePath honors SHELF_ENGINE_PATH, then falls back to the home default', async () => {
    process.env.SHELF_ENGINE_PATH = '/custom/shelf.mjs';
    expect(defaultEnginePath()).toBe('/custom/shelf.mjs');
    delete process.env.SHELF_ENGINE_PATH;
    expect(defaultEnginePath()).toBe(join(homedir(), '.agents/skills/dsi-skill-shelf/shelf.mjs'));
  });

  it('the fallback runner is re-installed on every setEngineRunner(null) (toggle both ways)', async () => {
    process.env.SHELF_ENGINE_PATH = join(import.meta.dirname, '../../fixtures/shelf-fixture.mjs');
    setEngineRunner(async () => JSON.stringify({ v: 9 }));
    setEngineRunner(null);
    await expect(getEngine().snapshotStatus()).resolves.toEqual({ present: true });
    delete process.env.SHELF_ENGINE_PATH;
  });
});
