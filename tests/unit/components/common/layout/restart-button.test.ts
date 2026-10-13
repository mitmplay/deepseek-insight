/**
 * RestartButton — the Restart Verb trigger (ADR 2026-10-12): click POSTs
 * /api/floor/restart, then the button polls through the blackout (the
 * server may die before answering) and reloads the page when the floor
 * answers again. Disabled + self-gated while restarting.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RestartButton from '$lib/components/common/layout/RestartButton.svelte';
const calls: Array<{ url: string; init?: RequestInit }> = [];
let devFloor = true; // the dev-mode gate answer (toggle per test)
function installFetch(snapshotSequence: Array<'down' | 'up'>): void {
  devFloor = true; // default: the old suite mounts on a dev floor
  let i = 0;
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/floor/mode') {
      return new Response(JSON.stringify({ dev: devFloor, mode: devFloor ? 'dev' : 'build' }), { status: 200 });
    }
    if (url === '/api/floor/restart') {
      return new Response(JSON.stringify({ ok: true, restarting: true }), { status: 200 });
    }
    if (url === '/api/plugins/snapshot') {
      const phase = snapshotSequence[Math.min(i, snapshotSequence.length - 1)];
      i += 1;
      return new Response(JSON.stringify({ ok: phase === 'up' }), { status: phase === 'up' ? 200 : 503 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch);
}

const reloadMock = vi.fn();
async function mountButton() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const comp = mount(RestartButton, { target, props: {} });
  flushSync();
  // wait for the onMount mode-fetch to settle and the gate to apply
  // (real timers normally; fake timers advance themselves)
  for (let k = 0; k < 50; k += 1) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1);
    else await new Promise((r) => setTimeout(r, 1));
    flushSync();
    const shown = !!target.querySelector('[data-testid="sidebar-restart-trigger"]');
    if (shown === devFloor) break;
  }
  const btn = target.querySelector('[data-testid="sidebar-restart-trigger"]') as HTMLButtonElement;
  return { btn, cleanup: () => { unmount(comp); target.remove(); } };
}
beforeEach(() => {
  reloadMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
describe('RestartButton dev gate (2026-10-13)', () => {
  it('a dev floor (mode.dev=true) shows the trigger', async () => {
    devFloor = true;
    installFetch(['up']);
    const h = await mountButton();
    await vi.waitFor(() => expect(h.btn).toBeTruthy());
    h.cleanup();
  });
  it('a build floor (mode.dev=false) never renders the trigger', async () => {
    installFetch(['up']);
    devFloor = false; // installFetch resets to true — flip after stubbing
    const h = await mountButton();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.btn).toBeNull();
    h.cleanup();
  });
  it('a failed mode fetch keeps the trigger hidden (hidden by default)', async () => {
    devFloor = false; // the stubbed 500 never answers — hidden either way
    vi.stubGlobal('fetch', (async () => new Response('{}', { status: 500 })) as typeof fetch);
    const h = await mountButton();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.btn).toBeNull();
    h.cleanup();
  });
});
describe('RestartButton', () => {
  it('renders the sidebar trigger with the floorRestart label', async () => {
    installFetch(['up']);
    const h = await mountButton();
    expect(h.btn).toBeTruthy();
    expect(h.btn.getAttribute('aria-label')).toBeTruthy();
  });
  it('click fires the restart POST and disables while restarting', async () => {
    installFetch(['down', 'down', 'up']);
    vi.stubGlobal('location', { reload: reloadMock });
    const h = await mountButton();
    h.btn.click();
    flushSync();
    expect(calls.some((c) => c.url === '/api/floor/restart' && c.init?.method === 'POST')).toBe(true);
    expect(h.btn.disabled).toBe(true);
    await vi.waitFor(() => expect(reloadMock).toHaveBeenCalled(), { timeout: 8000 });
  });
  it('a floor that never comes back times out and re-enables the trigger', async () => {
    vi.useFakeTimers();
    installFetch(['down']);
    vi.stubGlobal('location', { reload: reloadMock });
    const h = await mountButton();
    h.btn.click();
    flushSync();
    await vi.advanceTimersByTimeAsync(125_000);
    expect(reloadMock).not.toHaveBeenCalled();
    expect(h.btn.disabled).toBe(false);
    vi.useRealTimers();
  });
});

// AppSidebarHeader placement pin (operator-added, 2026-10-12): the restart
// trigger leads the header row, BEFORE the About trigger — both surfaces
// (expanded header + collapsed stub) carry the button.
describe('AppSidebarHeader placement (source pins)', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/components/common/layout/AppSidebarHeader.svelte'), 'utf-8');
  it('renders RestartButton before AboutButton', async () => {
    const restartIdx = src.indexOf('<RestartButton');
    const aboutIdx = src.indexOf('<AboutButton');
    expect(restartIdx).toBeGreaterThan(-1);
    expect(aboutIdx).toBeGreaterThan(restartIdx);
  });
  it('AppSidebar collapsed stub also carries the button before About', async () => {
    const app = readFileSync(join(process.cwd(), 'src/lib/components/common/layout/AppSidebar.svelte'), 'utf-8');
    const restartIdx = app.indexOf('<RestartButton');
    const aboutIdx = app.indexOf('<AboutButton');
    expect(restartIdx).toBeGreaterThan(-1);
    expect(aboutIdx).toBeGreaterThan(restartIdx);
  });
});
