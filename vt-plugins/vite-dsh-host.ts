/**
 * vite-dsh-host — embed the DSH web host inside DSI's Vite dev server.
 *
 * ADR: dev/architectural-decission/2026-10/2026-10-11 - The In-Process Host
 * (D1 embed pattern mirrors openclaw-insight's vite-ai-proxy; D2 token via
 * in-process stdout intercept; D3 entry resolution; D7 inspector note).
 *
 * Inert unless dsi.mjs spawned vite with DSI_DEV_IN_PROCESS=1 — the tandem
 * floor never loads a host from here (regression-pinned by 2.3 and by the
 * plugin's own status-matrix tests).
 *
 * Boot contract (spike verdict, ADR amendments 2026-10-11): the published
 * entry lib/bin.js exports runCli() which parses process.argv and blocks
 * while serving. We set argv, hook process.stdout for the token line
 * (re-announced on every tree reboot), and surface status on
 * globalThis.__dshHost. A non-resolvable entry boots UI-only, LOUD.
 */
import type { Plugin, ViteDevServer } from 'vite';
import { resolveDshEntry, readPinFromPackageJson } from './lib/dsh-entry-resolver.ts';
import { createLens, formatCensus, type CordisLens } from './lib/cordis-lens.ts';
import { tokenFromLine } from './lib/dsh-token-line.ts';
import { writeAuthToken } from './lib/dsh-token-sink.ts';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

/** Result of the host-level bounce (ADR-0025 D1): ok means the host was
 *  stopped and re-booted in-place — the vite process never died. */
export interface DshHostBounceResult {
  ok: boolean;
  reason?: 'no-handle' | 'in-progress' | 'port-held' | 'boot-failed';
}

export interface DshHostSurface {
  status: 'running' | 'disabled' | 'failed' | 'not-found';
  entryPath: string | null;
  version: string | null;
  source: string | null;
  startedAt: string | null;
  /** Port the embedded host listens on (config seam for tests). */
  port: number;
  stats: () => { tokenWrites: number; lastTokenAt: string | null };
  /** ADR-0025 D1: stop the embedded host, wait for the port, re-boot
   *  in-place with the CURRENT token pinned (D4). Present only when the
   *  plugin instance can own the boot (always, in this implementation);
   *  absent on surfaces minted before this ADR (defensive optional). */
  bounce?: () => Promise<DshHostBounceResult>;
}

export const DSH_HOST_PORT_DEFAULT = 3080;

/** Stop handle for the CURRENTLY embedded host, owned by whichever server
 *  instance booted it. Vite RESTARTS (a config/plugin file change) close the
 *  old httpServer but keep the process alive — the host's 3080 listener is
 *  independent and survives. Without this handle a restart double-boots:
 *  EADDRINUSE, then runCli's StartupError path process.exit(1)s the whole
 *  floor (operator-reported death, 2026-10-12). */
// (the activeShutdown module var was superseded by hostState() — the
//  process-level handle survives vite restarts; kept out to avoid two truths)

interface DshHostState {
  status: 'idle' | 'running' | 'failed';
  shutdown?: () => unknown;
  port?: number;
}
/** Cross-restart, cross-realm floor state. Module state dies when vite
 *  re-instantiates the plugin on restart; `process` survives both. */
function hostState(): DshHostState {
  const p = process as { __DSH_HOST_STATE__?: DshHostState };
  p.__DSH_HOST_STATE__ ??= { status: 'idle' };
  return p.__DSH_HOST_STATE__;
}
async function waitPortFree(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const p = spawnSync('lsof', ['-ti', 'tcp:' + port, '-sTCP:LISTEN'], { stdio: 'pipe' });
    if (p.status !== 0) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

export function dshHostPlugin(options: {
  /** Test seam: override DSI root (package.json with dsh.webVersion). */
  dsiRoot?: string;
  /** Test seam: fixed token sink target; default ~/.dsi/settings.yaml. */
  configPath?: string;
  /** Test seam: skip the real runCli boot, only resolve + report. */
  dryRun?: boolean;
} = {}): Plugin {
  const dsiRoot = options.dsiRoot ?? process.cwd();
  // DSI's config convention: DSI_CONFIG_PATH IS the file path (bin/dsi.mjs
  // dsiConfigPath) — never a directory. Default: ~/.dsi/settings.yaml.
  const configPath = options.configPath ?? process.env.DSI_CONFIG_PATH ?? join(process.env.HOME ?? '~', '.dsi', 'settings.yaml');

  const surface: DshHostSurface = {
    status: 'disabled',
    entryPath: null,
    version: null,
    source: null,
    startedAt: null,
    port: parseInt(process.env.DSH_HOST_PORT ?? String(DSH_HOST_PORT_DEFAULT), 10),
    stats: () => ({ tokenWrites: tokenWrites, lastTokenAt: lastTokenAt })
  };

  let tokenWrites = 0;
  let lastTokenAt: string | null = null;
  let streamHooksInstalled = false;
  /** The token the CURRENT browser URL holds — captured from the boot's
   *  announce and re-written before an in-place bounce so the re-booted host
   *  announces the SAME token (ADR-0025 D4). Lives in the plugin closure:
   *  a bounce runs inside one plugin instance's lifetime. */
  let lastAnnouncedToken: string | null = null;
  let bounceInFlight = false;

  /** Extract the launch token from one announce line, or null. The token
   *  is base64url-ish (letters, digits, - and _) and runs to end of line. */
  const tokenFromAnnounce = tokenFromLine;

  function handleAnnounce(chunk: unknown): void {
    const text = typeof chunk === 'string' ? chunk : String(chunk);
    const token = tokenFromAnnounce(text);
    if (!token) return;
    lastAnnouncedToken = token;
    const r = writeAuthToken(token, configPath);
    if (r.ok) {
      tokenWrites += 1;
      lastTokenAt = new Date().toISOString();
      process.stdout.write(`[dsh-host] authToken ${r.action} in settings.yaml\n`);
    } else {
      process.stdout.write(`[dsh-host] TOKEN WRITE FAILED: ${r.error}\n`);
    }
  }

  /** The announce may land on stdout OR stderr: vite's SSR console wrapper
   *  decides per module load which stream carries the host's console output,
   *  and the tandem shim never noticed because 2>&1 merges the streams
   *  (intermittent-miss bug 2026-10-11: stdout-only hook + a token holding
   *  the letter s truncated the extract — root cause was the broken split,
   *  fixed by the regex above; both streams are hooked regardless). */
  function installTokenIntercept(): void {
    if (streamHooksInstalled) return;
    streamHooksInstalled = true;
    for (const stream of [process.stdout, process.stderr] as const) {
      const original = stream.write.bind(stream);
      stream.write = function (chunk: unknown, ...rest: unknown[]) {
        handleAnnounce(chunk);
        return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
      } as typeof stream.write;
    }
  }

  /** The boot, extracted (ADR-0025 Task 1.1): configureServer fires it
   *  without awaiting; the in-place bounce awaits it. Same TWO paths the
   *  inline block ran since the 2026-10-11 spike — introspect or runCli. */
  async function bootHost(resolution: { packageDir: string; version: string; source: string; entryPath: string }): Promise<void> {
    installTokenIntercept();
    const useIntrospect = process.env.DSH_HOST_INTROSPECT === '1';
    const mod = await import(/* @vite-ignore */ 'file://' + resolution.entryPath) as { runCli?: () => Promise<void> };
    if (useIntrospect) {
      await bootWithIntrospection(resolution, surface, configPath);
      return;
    }
    if (typeof mod.runCli !== 'function') {
      console.error('[dsh-host] runCli not exported — skipping');
      surface.status = 'failed';
      return;
    }
    process.argv = ['node', 'dsh', 'web', '--port', String(surface.port), '--no-open'];
    console.log('[dsh-host] lens unavailable in runCli mode (no captured cordis root) — set DSH_HOST_INTROSPECT=1 for the lens (ADR-0024 D4)');
    surface.status = 'running';
    surface.startedAt = new Date().toISOString();
    const st = hostState();
    st.status = 'running';
    st.port = surface.port;
    st.shutdown = undefined; // runCli has no stop handle — restart keeps the host
    console.log(`[dsh-host] booting dsh ${resolution.version} in-process on port ${surface.port} (${resolution.source})`);
    try {
      await mod.runCli();
      // Spike note: runCli RESOLVES while the server keeps the process alive
      // (fire-and-forget boot) — a resolve is NOT a stop.
      console.log('[dsh-host] runCli resolved — server keeps serving in-process');
    } catch (e) {
      surface.status = 'failed';
      console.error('[dsh-host] runCli threw:', (e as Error).message);
    }
  }

  /** ADR-0025 D1 — the host-level bounce: stop ONLY the embedded host,
   *  wait for the port, re-boot in-place with the CURRENT token pinned
   *  (D4). The vite process never dies; the browser page and its URL
   *  survive. Fallback contract: any failure returns a typed result with
   *  ok=false so the caller (host-bounce route, then the chain) can fall
   *  back to the whole-floor sweep (D3). */
  async function bounceDshHost(): Promise<DshHostBounceResult> {
    if (bounceInFlight) return { ok: false, reason: 'in-progress' };
    const st = hostState();
    if (st.status !== 'running' || typeof st.shutdown !== 'function') {
      return { ok: false, reason: 'no-handle' };
    }
    bounceInFlight = true;
    try {
      console.log('[dsh-host] host-level bounce — stopping embedded host (vite stays up)');
      const stop = st.shutdown;
      st.shutdown = undefined;
      surface.status = 'failed'; // pessimistic until the re-boot proves otherwise
      try {
        await stop();
      } catch (e) {
        console.error('[dsh-host] bounce stop threw:', (e as Error).message);
      }
      const freed = await waitPortFree(surface.port, 10_000);
      if (!freed) return { ok: false, reason: 'port-held' };
      // D4 token pinning: re-write the token the CURRENT browser URL holds
      // so the re-booted host announces the same one (the sink is noop when
      // the value already matches — the log says so).
      if (lastAnnouncedToken) writeAuthToken(lastAnnouncedToken, configPath);
      const pin = readPinFromPackageJson(join(dsiRoot, 'package.json'));
      const resolution = resolveDshEntry({ pin: pin ?? undefined });
      if (resolution.status === 'not-found' || !existsSync(resolution.entryPath)) {
        surface.status = 'failed';
        return { ok: false, reason: 'boot-failed' };
      }
      surface.entryPath = resolution.entryPath;
      surface.version = resolution.version;
      surface.source = resolution.source;
      await bootHost(resolution);
      if (surface.status !== 'running') return { ok: false, reason: 'boot-failed' };
      console.log('[dsh-host] host-level bounce complete — same process, same URL');
      return { ok: true };
    } finally {
      bounceInFlight = false;
    }
  }

  return {
    name: 'dsh-host-embed',
    async configureServer(server: ViteDevServer) {
      // Inert unless the CLI said otherwise — the tandem floor contract.
      if (process.env.DSI_DEV_IN_PROCESS !== '1') {
        surface.status = 'disabled';
        console.log('[dsh-host] disabled (DSI_DEV_IN_PROCESS not set) — tandem floor owns the host');
      expose(surface);
        return;
      }

      surface.bounce = bounceDshHost; // ADR-0025 D1 — before expose, so __dshHost carries it
      expose(surface);
      // RESTART (vite re-runs configureServer when vt-plugins files change):
      // the OLD embedded host still owns its port — stop it if we hold the
      // handle (introspection mode), or keep serving from it if we don't
      // (runCli mode has no stop handle; the host does not depend on vite,
      // so it survives the restart fully functional — re-booting here would
      // EADDRINUSE and runCli's failure path exit(1)s the whole floor).
      // State reads from `process` — the plugin module is RE-INSTANTIATED on
      // restart, so module/surface state is fresh; process state survives.
      const st = hostState();
      if (st.status === 'running') {
        if (typeof st.shutdown === 'function') {
          console.log('[dsh-host] server restart — stopping previous embedded host');
          const stop = st.shutdown;
          st.shutdown = undefined;
          try {
            await stop();
          } catch (e) {
            console.error('[dsh-host] previous host stop threw:', (e as Error).message);
          }
          await waitPortFree(surface.port, 20_000);
        } else {
          console.log(`[dsh-host] server restart — previous host keeps serving :${surface.port} (runCli mode has no stop handle); skipping re-boot`);
          surface.status = 'running';
          return;
        }
      } else if (st.status === 'failed' || st.status === 'idle') {
        // FRESH process (bounce chain / first boot): the port may be held by
        // the PREVIOUS floor mid-death — SIGTERM→release takes a moment.
        // WAIT for the release instead of racing it: racing produced the
        // EADDRINUSE→exit(1)→no-node-process death (operator report +
        // bounce.log, 2026-10-12). Only an UNMANAGED holder after the wait
        // downgrades to UI-only.
        // Fast path, synchronous: if the port is already free there is
        // nothing to wait for — and configureServer must set the surface
        // status WITHOUT yielding (tests and the inspector read
        // globalThis.__dshHost right after the call; an unconditional
        // await left them seeing the initial 'disabled', 2026-10-13).
        const heldNow = spawnSync('lsof', ['-ti', 'tcp:' + surface.port, '-sTCP:LISTEN'], { stdio: 'pipe' }).status === 0;
        if (heldNow) {
          // Publish the pessimistic verdict SYNCHRONOUSLY: a holder at entry
          // means UI-only until proven otherwise (surface consumers read
          // __dshHost without awaiting configureServer). If the holder
          // releases inside the wait window, restore the baseline — the
          // boot path below then sets the real status.
          surface.status = 'not-found';
          const freed = await waitPortFree(surface.port, 20_000);
          if (!freed) {
            console.warn(`[dsh-host] port ${surface.port} still held after 20s by an unmanaged process — booting UI-only (stop the holder to reclaim the port)`);
            return;
          }
          surface.status = 'disabled';
        }
      }
      const pin = readPinFromPackageJson(join(dsiRoot, 'package.json'));
      const resolution = resolveDshEntry({ pin: pin ?? undefined });

      if (resolution.status === 'not-found') {
        surface.status = 'not-found';
        console.warn(`[dsh-host] entry not found: ${resolution.reason} — UI-only floor`);
        return;
      }

      surface.entryPath = resolution.entryPath;
      surface.version = resolution.version;
      surface.source = resolution.source;

      if (resolution.source === 'npx-unpinned') {
        console.warn(`[dsh-host] WARNING: no npx copy matches pin ${pin} — booting ${resolution.version} unpinned (spike: wrong versions fail the preset load)`);
      }

      if (options.dryRun) {
        console.log(`[dsh-host] dry-run: would boot ${resolution.entryPath} (${resolution.version}, ${resolution.source})`);
        surface.status = 'failed'; // not actually running
        return;
      }

      if (!existsSync(resolution.entryPath)) {
        surface.status = 'not-found';
        console.warn(`[dsh-host] entry vanished: ${resolution.entryPath} — UI-only floor`);
        return;
      }

      // Boot. TWO paths (spike 2026-10-11) — the logic lives in bootHost(),
      //  - DSH_HOST_INTROSPECT=1: runProfile DIRECTLY (owns the Cordis root,
      //    enables __dshHost.introspect(); bypasses bin.js arg expansion).
      //  - default: runCli (spike-proven, version-tolerant).
      // bootHost() lives in this plugin closure so the ADR-0025 in-place
      // bounce re-runs the SAME boot a vite restart runs. configureServer
      // fires it WITHOUT awaiting (tests read __dshHost right after the
      // call — 2026-10-13 sync fast-path note).
      void bootHost(resolution).catch((e: Error) => {
        surface.status = 'failed';
        console.error('[dsh-host] bootHost threw:', e.message);
      });

      // Ownership-aware teardown: on the FINAL close the process dies anyway
      // (host listener goes with it); on a vite RESTART the shutdown handle
      // was transferred to the new server instance before this fires, so the
      // hook must NOT stop the host that is about to be replaced cleanly.
      server.httpServer?.once('close', () => {
        const st = hostState();
        if (typeof st.shutdown === 'function') {
          console.log('[dsh-host] server closed — stopping embedded host we still own');
          const stop = st.shutdown;
          st.shutdown = undefined;
          try { stop(); } catch (e) { console.error('[dsh-host] stop threw:', (e as Error).message); }
        } else if (surface.status === 'running') {
          console.log('[dsh-host] server closed — host ownership transferred (restart) or runCli host keeps serving');
        }
      });
    }
  };
}

interface IntrospectionResolution {
  packageDir: string;
  version: string;
  source: string;
  entryPath: string;
}

/** The direct-runProfile boot (introspection mode). Imports the package's
 *  stable profile-boot.js re-export and calls runProfile itself — the
 *  returned { ctx } is the live Cordis root, exposed via
 *  __dshHost.introspect(). Best-effort: ANY throw falls back to runCli. */
async function bootWithIntrospection(
  resolution: IntrospectionResolution,
  surface: DshHostSurface,
  configPath: string
): Promise<void> {
  try {
    const bootUrl = 'file://' + join(resolution.packageDir, 'lib', 'profile-boot.js');
    const boot = await import(/* @vite-ignore */ bootUrl) as { runProfile?: (o: unknown) => Promise<{ ctx?: unknown }> };
    if (typeof boot.runProfile !== 'function') throw new Error('profile-boot.js did not export runProfile');
    // loadLayeredEnv from the host's own dependency tree — same env the CLI
    // would have loaded (createRequire resolves inside the npx dir).
    let environment: Record<string, string> = {};
    try {
      const { createRequire } = await import('node:module');
      const req = createRequire(join(resolution.packageDir, 'package.json'));
      const appBoot = req('@deepseek-ai/dsh-app-boot') as { loadLayeredEnv?: (n: string) => Record<string, string> };
      if (typeof appBoot.loadLayeredEnv === 'function') environment = appBoot.loadLayeredEnv('dsh');
    } catch { /* layered env stays {} — process.env still carries the shell */ }
    surface.status = 'running';
    surface.startedAt = new Date().toISOString();
    console.log(`[dsh-host] booting dsh ${resolution.version} in-process via runProfile (introspection mode) on port ${surface.port}`);
    const { ctx, shutdown } = await boot.runProfile({
      environment,
      profile: 'web',
      patchFiles: [],
      args: ['--port', String(surface.port), '--no-open']
    });
    console.log('[dsh-host] runProfile resolved — Cordis root captured (introspection ON)');
    const st = hostState();
    st.status = 'running';
    st.port = surface.port;
    st.shutdown = () => {
      // Dispose the root fiber (bin.js's own dispose path: app.current?.fiber.dispose()).
      // NOT runProfile's `shutdown` object — it is createProcessShutdown's
      // handle (shutdown.shutdown(code)) and may exit the process; disposing
      // the fiber closes the webserver without killing the floor.
      try {
        (ctx as { fiber?: { dispose?: () => unknown } }).fiber?.dispose();
      } catch (e) {
        console.error('[dsh-host] fiber dispose threw:', (e as Error).message);
      }
    };
    // Census (ADR-0024 D2): one structured multi-block print once the tree
    // has settled — grouped, per-block degrading, only if still running.
    const lens = createLens(ctx);
    (surface as DshHostSurface & { ctx?: unknown; introspect?: () => unknown; lens?: CordisLens }).ctx = ctx;
    (surface as DshHostSurface & { introspect?: () => unknown; lens?: CordisLens }).introspect = () => introspectCtx(ctx);
    (surface as DshHostSurface & { lens?: CordisLens }).lens = lens;
    setTimeout(() => {
      if (surface.status !== 'running') return;
      for (const line of formatCensus(lens.snapshot())) console.log(line);
    }, 15_000);
  } catch (e) {
    // One fallback retry through runCli — the spike must never leave the
    // floor down when the direct seam moved (chunk names shift per build).
    console.error('[dsh-host] introspection boot failed:', (e as Error).message, '— falling back to runCli');
    const mod = await import(/* @vite-ignore */ 'file://' + resolution.entryPath) as { runCli?: () => Promise<void> };
    if (typeof mod.runCli !== 'function') {
      surface.status = 'failed';
      return;
    }
    process.argv = ['node', 'dsh', 'web', '--port', String(surface.port), '--no-open'];
    console.log('[dsh-host] lens unavailable in runCli fallback (no captured cordis root) — set DSH_HOST_INTROSPECT=1 (ADR-0024 D4)');
    surface.status = 'running';
    await mod.runCli().catch((err: Error) => {
      surface.status = 'failed';
      console.error('[dsh-host] runCli threw:', err.message);
    });
  }
}

/** Read-only snapshot of the captured Cordis root. Defensive by design:
 *  cordis internals are vendor-pinned and may shift between releases.
 *
 *  Name enrichment (iteration 2): registry keys are mostly anonymous
 *  object plugins ({ apply }) — cordis derives display names from
 *  plugin.name and drops 'apply' (vendor/cordis/src/registry.ts:324).
 *  Enrichment sources, in order: (1) function/class name, (2) the object
 *  plugin's inject signature — DSH packages declare package-name edges
 *  there, which distinguishes applies, (3) the loader service's entry
 *  names, (4) profileContext.startedBundles. */
function introspectCtx(ctx: unknown): unknown {
  if (ctx === null || typeof ctx !== 'object') return { error: 'ctx not an object' };
  const c = ctx as {
    registry?: {
      keys?: () => IterableIterator<unknown>;
      get?: (k: unknown) => { name?: string } | undefined;
    };
    get?: (name: string) => unknown;
    fiber?: { state?: number; runtime?: { plugin?: { name?: string } } };
  };
  const out: Record<string, unknown> = {
    fiberState: c.fiber?.state,
    rootPlugin: c.fiber?.runtime?.plugin?.name ?? null
  };
  try {
    const keys = Array.from(c.registry?.keys?.() ?? []);
    out.pluginCount = keys.length;
    const names: string[] = [];
    const anonymous: string[] = [];
    for (const k of keys) {
      const shape = k as { name?: string; apply?: unknown; inject?: Record<string, unknown> };
      const runtimeName = c.registry?.get?.(k)?.name;
      const name = shape.name && shape.name !== 'apply'
        ? shape.name
        : runtimeName && runtimeName !== 'apply'
          ? runtimeName
          : null;
      if (name) {
        names.push(name);
      } else if (shape.apply) {
        const sig = Object.keys(shape.inject ?? {}).sort().join('+');
        anonymous.push(sig ? `apply(${sig})` : 'apply()');
      } else {
        anonymous.push(String(typeof k));
      }
    }
    out.named = names;
    out.anonymous = anonymous;
    out.anonymousCount = anonymous.length;
  } catch (e) {
    out.pluginError = (e as Error).message;
  }
  // Host-side identity surfaces (defensive: services shift between releases).
  try {
    const loader = typeof c.get === 'function' ? c.get('loader') : undefined;
    if (loader && typeof loader === 'object') {
      const l = loader as { entries?: unknown[]; name?: string };
      out.loaderEntries = Array.isArray(l.entries)
        ? l.entries.map((e) => (e as { name?: string }).name ?? '(unnamed)').slice(0, 100)
        : Object.keys(loader);
    }
  } catch { /* loader absent — fine */ }
  try {
    const pc = typeof c.get === 'function' ? c.get('profileContext') : undefined;
    if (pc && typeof pc === 'object') {
      out.startedBundles = (pc as { startedBundles?: string[] }).startedBundles ?? null;
    }
  } catch { /* profileContext absent — fine */ }
  return out;
}

function expose(surface: DshHostSurface): void {
  Object.defineProperty(globalThis, '__dshHost', {
    value: surface,
    writable: true,
    configurable: true,
    enumerable: false
  });
  // Realm-proof handle: vite's SSR module runner puts loaded modules in VM
  // contexts whose globalThis differs from the main realm, so the Node
  // inspector's console (context selector: internal / iFrame) cannot see
  // the main-realm property. `process` is the SAME object in every context
  // of the process — always reachable from any console.
  (process as { __DSH_HOST__?: DshHostSurface }).__DSH_HOST__ = surface;
}
