import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi, afterEach } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import { addPanelFromSidebar, resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import { resetSpineFeedForTests, refreshSpineFeed, spineFeed } from '$lib/services/conversation/spine-feed.svelte';

afterEach(() => { vi.restoreAllMocks(); resetSpineFeedForTests(); resetPanelRegistryForTests(); });

describe('probe3', () => {
  it('family stub', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const row = (sessionId: string, title: string, parentSessionId: string | null, origin: string) =>
        ({ sessionId, title, agentPreset: null, running: false, blank: false, updatedAt: 0, workspace: '/shared', parentSessionId, origin, turns: null });
      const body =
        url.includes('/api/dsh/sessions')
          ? { ok: true, sessions: [row('s-floor', 'Alpha', null, 'root'), row('sub', 'Sub', 's-floor', 'subagent')], workspaces: [] }
          : url.includes('/api/a2a') ? { ok: true, rows: [] }
          : url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
          : url.includes('/models') ? { ok: true, current: null }
          : url.includes('/api/settings') ? { ok: true, text: '', missing: true }
          : url.includes('/api/prompts') ? { ok: true, prompts: [] }
          : { ok: true, listing: { path: '', entries: [], truncated: false } };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    reactiveTestPage.params = {};
    reactiveTestPage.url = new URL('http://dsi/?sessionKey=s-floor');
    reactiveTestPage.data = { sessionId: 's-floor', entries: [], lastSeq: -1, running: false, workspace: '/shared' };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const instance = mount(Page, { target });
    const settle = async () => { for (let i = 0; i < 6; i++) { flushSync(); await Promise.resolve(); } flushSync(); };
    refreshSpineFeed();
    await settle();
    console.log('spine rows:', JSON.stringify(spineFeed.rows.map((r) => [r.sessionId, r.title])));
    expect(addPanelFromSidebar({ sessionId: 'sub' })).toBe(true);
    for (let i = 0; i < 40; i++) { flushSync(); await Promise.resolve(); await new Promise((r) => setTimeout(r, 25)); }
    flushSync();
    console.log('rows later:', JSON.stringify(spineFeed.rows.map((r) => [r.sessionId, r.title])));
    const headers = [...target.querySelectorAll('[data-testid="panels-row"] [data-testid="panel-header"]')].map((h) => h.getAttribute('title'));
    console.log('headers:', JSON.stringify(headers));
    unmount(instance);
    target.remove();
    expect(true).toBe(true);
  });
});
