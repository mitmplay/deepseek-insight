import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dshHostPlugin, type DshHostSurface } from '../../vt-plugins/vite-dsh-host';

// Status matrix (ADR-D1/D3): disabled (no env) · not-found (bad dir, empty
// cache) · resolved+dry-run (surface reports entry) · failed is reached via
// dryRun's "not actually running" label. The running arm is proven by the
// Wave-1 spike (probe D) and Wave-4 e2e, not re-booted here.
let dsiRoot: string;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  dsiRoot = mkdtempSync(join(tmpdir(), 'dsh-plugin-'));
  writeFileSync(join(dsiRoot, 'package.json'), JSON.stringify({ dsh: { webVersion: '0.2.1-alpha.2' } }));
  for (const k of ['DSI_DEV_IN_PROCESS', 'DSH_WEB_CMD', 'DSH_HOST_DIR', 'DSI_CONFIG_PATH']) {
    savedEnv[k] = process.env[k];
  }
  process.env.DSI_CONFIG_PATH = join(dsiRoot, 'settings.yaml');
});

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dsiRoot, { recursive: true, force: true });
});

function fakeServer() {
  return { httpServer: { once: () => {} } } as never;
}

function surfaceOf(pluginOptions: Parameters<typeof dshHostPlugin>[0]): DshHostSurface {
  delete (globalThis as { __dshHost?: unknown }).__dshHost;
  const p = dshHostPlugin(pluginOptions);
  p.configureServer!(fakeServer());
  const s = (globalThis as { __dshHost?: DshHostSurface }).__dshHost;
  expect(s).toBeDefined();
  return s as DshHostSurface;
}

describe('vite-dsh-host status matrix', () => {
  it('disabled: no DSI_DEV_IN_PROCESS → inert, surface still exposed', () => {
    delete process.env.DSI_DEV_IN_PROCESS;
    delete process.env.DSH_HOST_DIR;
    const s = surfaceOf({ dsiRoot });
    expect(s.status).toBe('disabled');
  });

  it('not-found: env set, entry dir bogus → loud UI-only floor', () => {
    process.env.DSI_DEV_IN_PROCESS = '1';
    process.env.DSH_HOST_DIR = '/nonexistent/dsh/checkout';
    const s = surfaceOf({ dsiRoot });
    expect(s.status).toBe('not-found');
    expect(s.entryPath).toBeNull();
  });

  it('resolved (dry-run): surface carries entry path, version, source', () => {
    delete process.env.DSH_HOST_DIR;
    // Pin a free port — the ambient floor may hold 3080, and the plugin's
    // port-held guard (correctly) downgrades to not-found.
    const savedPort = process.env.DSH_HOST_PORT;
    process.env.DSH_HOST_PORT = '39999';
    // dry-run with a real checkout so resolution succeeds deterministically
    const checkout = mkdtempSync(join(tmpdir(), 'dsh-real-'));
    mkdirSync(join(checkout, 'lib'), { recursive: true });
    writeFileSync(join(checkout, 'lib', 'bin.js'), 'export { runCli };\n');
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ version: '9.9.9-test' }));
    process.env.DSH_WEB_CMD = 'dir:' + checkout;
    try {
      const s = surfaceOf({ dsiRoot, dryRun: true });
      // dry-run resolves then marks failed (not actually running) — by design
      expect(s.status).toBe('failed');
      expect(s.entryPath).toBe(join(checkout, 'lib', 'bin.js'));
      expect(s.version).toBe('9.9.9-test');
      expect(s.source).toBe('web-cmd');
    } finally {
      if (savedPort === undefined) delete process.env.DSH_HOST_PORT;
      else process.env.DSH_HOST_PORT = savedPort;
      delete process.env.DSH_WEB_CMD;
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  it('surface port: DSH_HOST_PORT env is honored, default is 3080', () => {
    delete process.env.DSI_DEV_IN_PROCESS;
    const before = process.env.DSH_HOST_PORT;
    process.env.DSH_HOST_PORT = '3477';
    const s = surfaceOf({ dsiRoot });
    expect(s.port).toBe(3477);
    if (before === undefined) delete process.env.DSH_HOST_PORT;
    else process.env.DSH_HOST_PORT = before;
    const s2 = surfaceOf({ dsiRoot });
    expect(s2.port).toBe(3080);
  });

  it('tandem contract: plugin never boots a host when the env marker is absent — even with a perfect checkout available', () => {
    delete process.env.DSI_DEV_IN_PROCESS;
    const s = surfaceOf({ dsiRoot });
    // The whole regression point of 2.3: no DSI_DEV_IN_PROCESS → no boot, ever.
    expect(['disabled', 'not-found']).toContain(s.status);
    expect(s.status).not.toBe('running');
  });
});
