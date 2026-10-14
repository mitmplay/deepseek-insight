import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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

// ADR-0024 — The Cordis Lens (Wave 1): lens queries against a synthetic ctx
// shaped like the real cordis root; census formatting; runCli-mode gate.
import { createLens, formatCensus, type CordisLens } from '../../vt-plugins/lib/cordis-lens';

function namedPlugin(name: string) {
  const f = () => {};
  Object.defineProperty(f, 'name', { value: name });
  return f;
}

function syntheticCtx() {
  const anonApply = { apply: () => {}, inject: { loader: {}, http: {} } };
  const services: Record<string, unknown> = {
    loader: { entries: [{ name: 'one' }, { name: 'two' }] },
    profileContext: { startedBundles: ['alpha', 'beta'] }
  };
  return {
    registry: {
      keys: () => [namedPlugin('BrowserAuth'), anonApply, 42][Symbol.iterator](),
      get: (k: unknown) => (typeof k === 'function' ? { name: (k as () => void).name } : undefined)
    },
    get: (name: string) => services[name],
    fiber: {
      state: 2,
      runtime: { plugin: { name: 'root' } },
      children: [{ state: 2, runtime: { plugin: { name: 'child-a' } }, children: [] }]
    },
    __services: services
  } as never;
}

describe('cordis lens (ADR-0024)', () => {
  it('1.1-T plugins: named, anonymous-apply with inject signature, opaque', () => {
    const lens = createLens(syntheticCtx());
    const r = lens.plugins();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(3);
    expect(r.value[0]).toMatchObject({ name: 'BrowserAuth', kind: 'named' });
    expect(r.value[1]).toMatchObject({ kind: 'anonymous-apply', injectSignature: 'http+loader' });
    expect(r.value[2]).toMatchObject({ kind: 'opaque' });
  });

  it('1.1-T service hit returns found with detail; miss is a named result, not a throw', () => {
    const lens = createLens(syntheticCtx());
    const hit = lens.service('loader');
    expect(hit.found).toBe(true);
    expect(hit.detail).toContain('entries');
    const miss = lens.service('nope');
    expect(miss.found).toBe(false);
    expect(miss.detail).toContain('nope');
  });

  it('1.1-T moved internal (registry.keys absent) → loud per-field error, other fields survive', () => {
    const lens = createLens({ get: () => undefined, fiber: { state: 2 } } as never);
    const snap = lens.snapshot();
    expect(snap.plugins.ok).toBe(false);
    expect(snap.fiberState).toBe(2);
    expect(snap.bundles.ok).toBe(true);
    const p = lens.plugins();
    if (!p.ok) expect(p.error).toMatch(/keys|iterat/i);
  });

  it('1.1-T tree: fiber states from the root down', () => {
    const lens = createLens(syntheticCtx());
    const r = lens.tree();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pluginName).toBe('root');
    expect(r.value.children[0]?.pluginName).toBe('child-a');
  });

  it('1.1-T bundles: startedBundles + loader entries', () => {
    const lens = createLens(syntheticCtx());
    const r = lens.bundles();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.startedBundles).toEqual(['alpha', 'beta']);
    expect(r.value.loaderEntries).toEqual(['one', 'two']);
  });

  it('1.2-T census: grouped blocks, per-block degradation on plugin failure', () => {
    const good = formatCensus(createLens(syntheticCtx()).snapshot());
    expect(good[0]).toMatch(/census: fiber=ACTIVE rootPlugin=root/);
    expect(good.some((l) => l.includes('census named:'))).toBe(true);
    expect(good.some((l) => l.includes('census bundles: alpha, beta'))).toBe(true);
    const brokenCtx = { registry: {} } as never; // registry.keys missing → plugins field fails
    const lines = formatCensus(createLens(brokenCtx).snapshot());
    expect(lines.some((l) => l.includes('census plugins FAILED:'))).toBe(true);
    expect(lines[0]).toMatch(/census:/);
    expect(lines.some((l) => l.includes('census service profileContext:'))).toBe(true);
  });

  it('1.3-T dry-run surface exposes no lens (introspection-only, D4)', () => {
    // disabled path never boots → surface stays lensless
    delete process.env.DSI_DEV_IN_PROCESS;
    const s = surfaceOf({ dsiRoot }) as DshHostSurface & { lens?: CordisLens };
    expect(s.lens).toBeUndefined();
  });
});

// ADR-0025 — The Host-Level Bounce (Wave 1): the in-place stop/re-boot verb.
// Arms: no-handle fallback (D3), full bounce against a fake checkout (the
// vite process is the test process — it obviously survives), token pinning
// (D4: the announce-captured token is still in settings.yaml after bounce).
import { vi } from 'vitest';

describe('vite-dsh-host host-level bounce (ADR-0025)', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let checkout: string;
  let configPath: string;
  const PORT = 39998;

  beforeAll(() => {
    for (const k of ['DSI_DEV_IN_PROCESS', 'DSH_WEB_CMD', 'DSH_HOST_PORT', 'DSH_HOST_INTROSPECT', 'DSI_CONFIG_PATH']) {
      savedEnv[k] = process.env[k];
    }
    process.env.DSI_DEV_IN_PROCESS = '1';
    delete process.env.DSH_HOST_INTROSPECT; // runCli path — the fake checkout speaks runCli
    process.env.DSH_HOST_PORT = String(PORT);
    // INSIDE the repo: vitest's module runner cannot native-import file://
    // modules from outside the project root (probe 2026-10-14 — tmp/ works,
    // $TMPDIR does not). tmp/ is the repo's scratch dir.
    checkout = join(process.cwd(), 'tmp', 'dsh-bounce-fake-' + Date.now());
    mkdirSync(join(checkout, 'lib'), { recursive: true });
    writeFileSync(join(checkout, 'lib', 'bin.js'),
      'export async function runCli() { globalThis.__BOUNCE_BOOTED = (globalThis.__BOUNCE_BOOTED ?? 0) + 1; }\n');
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ version: '9.9.9-bounce' }));
    process.env.DSH_WEB_CMD = 'dir:' + checkout;
    configPath = join(dsiRoot, 'bounce-settings.yaml');
    process.env.DSI_CONFIG_PATH = configPath;
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete (globalThis as { __BOUNCE_BOOTED?: number }).__BOUNCE_BOOTED;
    rmSync(checkout, { recursive: true, force: true });
  });

  function hostState() {
    return (process as { __DSH_HOST_STATE__?: { status: string; shutdown?: () => unknown; port?: number } }).__DSH_HOST_STATE__!;
  }

  it('no-handle: a floor without a stop handle falls back (D3)', async () => {
    const s = surfaceOf({ dsiRoot, dryRun: true, configPath });
    expect(typeof s.bounce).toBe('function');
    const res = await s.bounce!();
    expect(res).toEqual({ ok: false, reason: 'no-handle' });
  });

  it('full bounce: stop, re-boot in-place, same-process (D1), token pinned (D4)', async () => {
    vi.stubEnv('DSH_HOST_PORT', String(PORT));
    const s = surfaceOf({ dsiRoot, configPath });
    expect(typeof s.bounce).toBe('function');
    // The configureServer boot fires un-awaited — wait for the fake runCli.
    await vi.waitFor(() => {
      expect((globalThis as { __BOUNCE_BOOTED?: number }).__BOUNCE_BOOTED ?? 0).toBeGreaterThanOrEqual(1);
    });
    // Simulate the boot announce so the intercept captures the URL token.
    const TOKEN = 'TESTTOK_abc-123';
    process.stdout.write(`dsh web: http://127.0.0.1:${PORT}/?token=${TOKEN}\n`);
    await vi.waitFor(() => {
      expect(readFileSync(configPath, 'utf8')).toContain(TOKEN);
    });
    // Install the stop handle the introspection boot would have returned.
    let stopped = false;
    hostState().status = 'running';
    hostState().shutdown = () => { stopped = true; };

    const res = await s.bounce!();
    expect(res).toEqual({ ok: true });
    expect(stopped).toBe(true); // the OLD host was stopped (D1)
    expect((globalThis as { __BOUNCE_BOOTED?: number }).__BOUNCE_BOOTED).toBe(2); // re-booted in-place
    expect(s.status).toBe('running');
    expect(readFileSync(configPath, 'utf8')).toContain(TOKEN); // D4: token survives
    expect(hostState().shutdown).toBeUndefined(); // runCli path: no handle again
  });
});
