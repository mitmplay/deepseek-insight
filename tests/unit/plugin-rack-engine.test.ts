// plugin-rack engine edges — real defaultRunner against throwaway node
// scripts (no real rack.mjs), stub runner for the run() branch mop.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  defaultEnginePath,
  getRackEngine,
  setRackEngineRunner
} from '../../src/lib/server/plugins/engine';
import {
  RackEngineFailedError,
  RackEngineMissingError
} from '../../src/lib/server/plugins/types';

const tmp = mkdtempSync(join(tmpdir(), 'rack-engine-'));
const script = (name: string, body: string) => {
  const p = join(tmp, name);
  writeFileSync(p, body);
  return p;
};

const ENV = process.env.RACK_ENGINE_PATH;
afterAll(() => {
  if (ENV === undefined) delete process.env.RACK_ENGINE_PATH;
  else process.env.RACK_ENGINE_PATH = ENV;
  rmSync(tmp, { recursive: true, force: true });
});

// A path that exists so run()'s existsSync gate passes for stub-runner tests.
const SENTINEL = script('sentinel.mjs', 'console.log(JSON.stringify({v:1}))');

beforeEach(() => {
  process.env.RACK_ENGINE_PATH = SENTINEL;
  setRackEngineRunner(null);
});

describe('defaultEnginePath', () => {
  it('honors RACK_ENGINE_PATH', () => {
    expect(defaultEnginePath()).toBe(SENTINEL);
  });
  it('falls back to the rack.mjs home location', () => {
    delete process.env.RACK_ENGINE_PATH;
    expect(defaultEnginePath()).toContain('dsi-plugin-rack/rack.mjs');
  });
});

describe('run() via the real default runner', () => {
  it('parses a v:1 stdout payload', async () => {
    process.env.RACK_ENGINE_PATH = script('ok.mjs', 'console.log(JSON.stringify({v:1,present:true}))');
    await expect(getRackEngine().snapshotStatus()).resolves.toEqual({ present: true });
  });

  it('recovers the JSON fail payload from a nonzero exit (err.stdout arm)', async () => {
    process.env.RACK_ENGINE_PATH = script(
      'fail-with-stdout.mjs',
      'console.log(JSON.stringify({v:1,present:false}));process.exit(1)'
    );
    await expect(getRackEngine().snapshotStatus()).resolves.toEqual({ present: false });
  });

  it('wraps a bare nonzero exit (no stdout) as RackEngineFailedError', async () => {
    process.env.RACK_ENGINE_PATH = script('fail-quiet.mjs', 'process.exit(3)');
    await expect(getRackEngine().snapshotStatus()).rejects.toBeInstanceOf(RackEngineFailedError);
  });

  it('rejects non-JSON stdout', async () => {
    process.env.RACK_ENGINE_PATH = script('noisy.mjs', "console.log('not json')");
    await expect(getRackEngine().snapshotStatus()).rejects.toThrow('non-JSON output');
  });

  it('rejects a wire version mismatch', async () => {
    process.env.RACK_ENGINE_PATH = script('v2.mjs', 'console.log(JSON.stringify({v:2}))');
    await expect(getRackEngine().snapshotStatus()).rejects.toThrow('wire version mismatch: v=2');
  });

  it('reports a missing engine binary', async () => {
    process.env.RACK_ENGINE_PATH = join(tmp, 'absent.mjs');
    await expect(getRackEngine().snapshotStatus()).rejects.toBeInstanceOf(RackEngineMissingError);
  });
});

describe('run() branches via a stub runner', () => {
  it('maps a killed engine to the timeout failure', async () => {
    setRackEngineRunner(async () => {
      const err = new Error('signal SIGTERM') as Error & { killed?: boolean };
      err.killed = true;
      throw err;
    });
    await expect(getRackEngine().snapshotStatus()).rejects.toThrow('timed out after 120000ms');
  });

  it('maps a generic runner rejection to its message', async () => {
    setRackEngineRunner(async () => {
      throw new Error('spawn ENOENT');
    });
    await expect(getRackEngine().snapshotStatus()).rejects.toThrow('spawn ENOENT');
  });

  it('non-Error rejections stringify', async () => {
    setRackEngineRunner(async () => {
      throw 'plain string boom';
    });
    await expect(getRackEngine().snapshotStatus()).rejects.toThrow('plain string boom');
  });
});

describe('getRackEngine verb shapes', () => {
  it('refresh passes --reload only when asked and carries errors when present', async () => {
    const calls: string[][] = [];
    let withWarnings = true;
    setRackEngineRunner(async (_p, args) => {
      calls.push(args);
      return JSON.stringify({ v: 1, ok: true, reused: true, snapshot: { v: 1, generatedAt: 't', profile: 'p', plugins: [] }, ...(withWarnings ? { errors: ['w'] } : {}) });
    });
    const withErrors = await getRackEngine().refresh(true, ['--profile', 'x']);
    expect(calls[0]).toEqual(['refresh', '--reload', '--profile', 'x']);
    expect(withErrors.errors).toEqual(['w']);
    expect(withErrors.reused).toBe(true);

    withWarnings = false;
    const noErrors = await getRackEngine().refresh(false);
    expect(calls[1]).toEqual(['refresh']);
    expect('errors' in noErrors).toBe(false);
  });

  it('refresh rejects a snapshot-less payload', async () => {
    setRackEngineRunner(async () => JSON.stringify({ v: 1, ok: true }));
    await expect(getRackEngine().refresh(false)).rejects.toThrow('returned no snapshot');
  });

  it('apply passes targets + extras and rejects a results-less payload', async () => {
    const calls: string[][] = [];
    setRackEngineRunner(async (_p, args) => {
      calls.push(args);
      return JSON.stringify({ v: 1, ok: true, results: [{ id: 'a', ok: true }] });
    });
    await expect(getRackEngine().apply('install', ['a', 'b'], ['--yarn'])).resolves.toEqual([
      { id: 'a', ok: true }
    ]);
    expect(calls[0]).toEqual(['apply', 'install', 'a', 'b', '--yarn']);

    setRackEngineRunner(async () => JSON.stringify({ v: 1, ok: false }));
    await expect(getRackEngine().apply('remove', ['a'])).rejects.toThrow('returned no results');
  });

  it('snapshotStatus coerces present to a boolean', async () => {
    setRackEngineRunner(async () => JSON.stringify({ v: 1, present: 'yes' }));
    await expect(getRackEngine().snapshotStatus()).resolves.toEqual({ present: true });
  });
});
