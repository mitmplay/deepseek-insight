/**
 * cordis-lens — read-only named queries over a captured cordis root.
 *
 * ADR-0024 (The Cordis Lens, 2026-10-13, D1/D2): the embedded host's
 * introspection seam grows from one hard-coded snapshot into a query
 * surface. Every reader is defensive by design — cordis internals are
 * vendor-pinned and shift between releases — and every failure is LOUD and
 * per-field: a moved internal reports what moved, it never returns
 * undefined quietly. The lens never writes, disposes, or configures; it
 * imports nothing from the host plugin (module boundary, PRD module map).
 */

/** One resolved field: a value, or a named loud error. */
export type LensField<T> = { ok: true; value: T } | { ok: false; error: string };

export interface LensPluginInfo {
  name: string | null;
  kind: 'named' | 'anonymous-apply' | 'opaque';
  injectSignature: string | null;
  runtimeName: string | null;
}

export interface LensTreeFiber {
  pluginName: string | null;
  state: number | null;
  children: LensTreeFiber[];
}

export interface LensSnapshot {
  fiberState: number | null;
  rootPlugin: string | null;
  plugins: LensField<LensPluginInfo[]>;
  services: LensField<Record<string, string>>;
  bundles: LensField<{ startedBundles: string[] | null; loaderEntries: string[] | null }>;
}

/** Known fiber lifecycle states (vendor/cordis/src/fiber.ts, FiberState). */
export const FIBER_STATES: Record<number, string> = {
  0: 'PENDING',
  1: 'LOADING',
  2: 'ACTIVE',
  3: 'ERROR',
  4: 'UNLOADING',
  5: 'DISPOSED'
};

type PluginShape = { name?: string; apply?: unknown; inject?: Record<string, unknown> };
type CtxShape = {
  registry?: { keys?: () => IterableIterator<unknown>; get?: (k: unknown) => { name?: string } | undefined };
  get?: (name: string) => unknown;
  fiber?: {
    state?: number;
    runtime?: { plugin?: { name?: string } };
    children?: IterableIterator<unknown> | unknown[];
  };
};

function field<T>(fn: () => T): LensField<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: (e as Error).message || String(e) };
  }
}

/** The inject signature keys of one plugin, sorted — the discriminator for
 *  anonymous apply-objects (ADR-0024 fact 5). */
function injectSignature(inject: Record<string, unknown> | undefined): string | null {
  if (!inject || typeof inject !== 'object') return null;
  const keys = Object.keys(inject).sort();
  return keys.length ? keys.join('+') : '';
}

function readPlugins(c: CtxShape): LensField<LensPluginInfo[]> {
  return field(() => {
    if (!c.registry || typeof c.registry.keys !== 'function') {
      throw new Error('ctx.registry.keys is not a function (moved internal)');
    }
    const keys = Array.from(c.registry.keys());
    return keys.map((k) => {
      const shape = (k ?? {}) as PluginShape;
      const runtimeName = c.registry?.get?.(k)?.name ?? null;
      const sig = injectSignature(shape.inject);
      if (shape.name && shape.name !== 'apply') {
        return { name: shape.name, kind: 'named', injectSignature: sig, runtimeName } as LensPluginInfo;
      }
      if (shape.apply) {
        return { name: null, kind: 'anonymous-apply', injectSignature: sig, runtimeName } as LensPluginInfo;
      }
      return { name: null, kind: 'opaque', injectSignature: sig, runtimeName } as LensPluginInfo;
    });
  });
}

/** Resolve one service by name. A miss is a RESULT (named reason), not a
 *  throw — "no such service" is a fact about the tree, not a lens failure. */
function readService(c: CtxShape, name: string): { found: boolean; detail: string; value: unknown } {
  if (typeof c.get !== 'function') return { found: false, detail: 'ctx.get is not a function (moved internal)', value: undefined };
  const value = c.get(name);
  if (value === undefined || value === null) {
    return { found: false, detail: 'no service registered under ' + JSON.stringify(name), value };
  }
  const keys = typeof value === 'object' ? Object.keys(value as object).slice(0, 20) : [];
  return { found: true, detail: keys.join(', '), value };
}

function readServices(c: CtxShape): LensField<Record<string, string>> {
  return field(() => {
    const out: Record<string, string> = {};
    for (const name of ['loader', 'profileContext']) {
      const r = readService(c, name);
      out[name] = r.found ? r.detail : r.detail;
    }
    return out;
  });
}

function readBundles(c: CtxShape): LensField<{ startedBundles: string[] | null; loaderEntries: string[] | null }> {
  return field(() => {
    let startedBundles: string[] | null = null;
    let loaderEntries: string[] | null = null;
    const pc = typeof c.get === 'function' ? c.get('profileContext') : undefined;
    if (pc && typeof pc === 'object' && Array.isArray((pc as { startedBundles?: unknown }).startedBundles)) {
      startedBundles = (pc as { startedBundles: string[] }).startedBundles;
    }
    const loader = typeof c.get === 'function' ? c.get('loader') : undefined;
    if (loader && typeof loader === 'object' && Array.isArray((loader as { entries?: unknown }).entries)) {
      loaderEntries = ((loader as { entries: unknown[] }).entries as { name?: string }[])
        .map((e) => e.name ?? '(unnamed)')
        .slice(0, 100);
    }
    return { startedBundles, loaderEntries };
  });
}

/** Walk the fiber tree depth-first from the root fiber. Children are
 *  duck-typed: anything iterable on fiber.children counts. */
function readTree(c: CtxShape): LensField<LensTreeFiber> {
  return field(() => {
    const seen = new Set<unknown>();
    function walk(f: NonNullable<CtxShape['fiber']>): LensTreeFiber {
      if (seen.has(f)) return { pluginName: null, state: null, children: [], };
      seen.add(f);
      const kids: LensTreeFiber[] = [];
      const children = (f as { children?: unknown }).children;
      if (typeof children === 'object' && children !== null && Symbol.iterator in (children as object)) {
        for (const child of children as Iterable<NonNullable<CtxShape['fiber']>>) {
          if (child && typeof child === 'object') kids.push(walk(child));
        }
      }
      return {
        pluginName: f.runtime?.plugin?.name ?? null,
        state: typeof f.state === 'number' ? f.state : null,
        children: kids
      };
    }
    const root = c.fiber ? walk(c.fiber) : { pluginName: null, state: null, children: [] };
    // Registry-side enumeration (KB open question, closed 2026-10-13): cordis
    // tracks each plugin's fibers on its RUNTIME, not under the root fiber's
    // children — runtime = { name, callback, fibers: DisposableList, Config }
    // (vendor/cordis/src/registry.ts:326); DisposableList keeps them in a
    // private Map at .map (vendor/cordis/src/utils.ts:5-18). A root-children
    // walk alone under-reports a real floor to zero.
    if (c.registry && typeof c.registry.keys === 'function' && typeof c.registry.get === 'function') {
      const seenFibers = new Set<unknown>();
      for (const k of c.registry.keys()) {
        const rt = c.registry.get(k) as { name?: string; fibers?: unknown } | undefined;
        const list = rt?.fibers as { map?: Map<unknown, unknown> } | undefined;
        if (!list || !(list.map instanceof Map)) continue;
        for (const fb of list.map.values()) {
          if (!fb || typeof fb !== 'object' || seenFibers.has(fb)) continue;
          seenFibers.add(fb);
          const fib = fb as { state?: unknown; runtime?: { plugin?: { name?: string } } };
          root.children.push({
            pluginName: rt.name ?? fib.runtime?.plugin?.name ?? null,
            state: typeof fib.state === 'number' ? fib.state : null,
            children: []
          });
        }
      }
    }
    return root;
  });
}

export interface CordisLens {
  /** Census snapshot: plugins, well-known services, bundles, fiber root. */
  snapshot(): LensSnapshot;
  /** One plugin census entry list (D1: the map). */
  plugins(): LensField<LensPluginInfo[]>;
  /** One service by name — miss is a named result, not a throw. */
  service(name: string): { found: boolean; detail: string; value: unknown };
  /** Fiber tree from the root, depth-first. */
  tree(): LensField<LensTreeFiber>;
  /** Started bundles + loader entries. */
  bundles(): LensField<{ startedBundles: string[] | null; loaderEntries: string[] | null }>;
  /** The captured context, for anything the named queries miss. */
  readonly ctx: unknown;
}

export function createLens(ctx: unknown): CordisLens {
  const c = (ctx ?? {}) as CtxShape;
  return {
    snapshot(): LensSnapshot {
      return {
        fiberState: typeof c.fiber?.state === 'number' ? c.fiber.state : null,
        rootPlugin: c.fiber?.runtime?.plugin?.name ?? null,
        plugins: readPlugins(c),
        services: readServices(c),
        bundles: readBundles(c)
      };
    },
    plugins: () => readPlugins(c),
    service: (name: string) => readService(c, String(name)),
    tree: () => readTree(c),
    bundles: () => readBundles(c),
    ctx
  };
}

/** Format one snapshot into census log blocks (D2: grouped, per-block
 *  degrading — a failed block prints its error, the others still print). */
export function formatCensus(snap: LensSnapshot): string[] {
  const lines: string[] = [];
  const stateName = snap.fiberState !== null ? (FIBER_STATES[snap.fiberState] ?? String(snap.fiberState)) : 'unknown';
  lines.push('[dsh-host] census: fiber=' + stateName + ' rootPlugin=' + (snap.rootPlugin ?? '(none)'));
  if (snap.plugins.ok) {
    const named = snap.plugins.value.filter((p) => p.kind === 'named');
    const anon = snap.plugins.value.filter((p) => p.kind === 'anonymous-apply');
    lines.push('[dsh-host] census plugins: ' + snap.plugins.value.length + ' total, ' + named.length + ' named, ' + anon.length + ' anonymous');
    lines.push('[dsh-host] census named: ' + (named.map((p) => p.name).slice(0, 20).join(', ') || '(none)'));
    lines.push('[dsh-host] census anonymous (by inject signature): ' + (anon.map((p) => 'apply(' + (p.injectSignature ?? '') + ')').slice(0, 10).join(', ') || '(none)'));
  } else {
    lines.push('[dsh-host] census plugins FAILED: ' + snap.plugins.error);
  }
  if (snap.services.ok) {
    for (const [name, detail] of Object.entries(snap.services.value)) {
      lines.push('[dsh-host] census service ' + name + ': ' + detail);
    }
  } else {
    lines.push('[dsh-host] census services FAILED: ' + snap.services.error);
  }
  if (snap.bundles.ok) {
    lines.push('[dsh-host] census bundles: ' + (snap.bundles.value.startedBundles ?? []).join(', '));
    lines.push('[dsh-host] census loader entries: ' + (snap.bundles.value.loaderEntries ?? []).slice(0, 15).join(', '));
  } else {
    lines.push('[dsh-host] census bundles FAILED: ' + snap.bundles.error);
  }
  return lines;
}
