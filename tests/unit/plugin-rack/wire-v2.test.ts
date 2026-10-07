import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSnapshot, CACHE_VERSION } from '../../../.agents/skills/dsi-plugin-rack/rack.mjs';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pgr-wire-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function setup(opts: { garden?: object[]; reffLines?: string[]; manifestDeps?: Record<string, string>; cacheVersion?: number }) {
  const garden = join(home, 'garden');
  const wf = (p: string, c: string) => writeFileSync(p, c);
  if (opts.garden) {
    mkdirSync(garden, { recursive: true });
    for (const pkg of opts.garden as any[]) {
      const d = join(garden, pkg.name.replace('@local/', ''));
      mkdirSync(d, { recursive: true });
      wf(join(d, 'package.json'), JSON.stringify(pkg));
    }
  }
  const reff = ['Plugins Resources:', ...(opts.reffLines ?? [])].join('\n');
  wf(join(home, 'plugins-reff.md'), reff);
  const manifest = { name: 'dsh-profile-web', private: true, dsh: { profile: { bundles: [] } }, dependencies: opts.manifestDeps ?? {} };
  wf(join(home, 'package.json'), JSON.stringify(manifest, null, 2));
  let cachePath: string | undefined;
  if (opts.cacheVersion) {
    cachePath = join(home, 'pgr-cache.json');
    wf(cachePath, JSON.stringify({ v: opts.cacheVersion, ok: true, snapshot: { plugins: [] } }));
  }
  return { garden, reffPath: join(home, 'plugins-reff.md'), manifestPath: join(home, 'package.json'), cachePath };
}

const RESEARCH = { name: '@local/dsh-research-preset', version: '1.0.0', private: true, description: 'Read-only research agent', dsh: { bundle: { patch: './cordis.patch.yml' } } };
const APPDEV = { name: '@local/dsh-app-dev-preset', version: '1.0.0', private: true, description: 'Full application-development agent', dsh: { bundle: { patch: './cordis.patch.yml' } } };

describe('buildSnapshot wire v2', () => {
  it('emits CACHE_VERSION 2', () => {
    expect(CACHE_VERSION).toBe(2);
  });

  it('rows carry group, description, and version', () => {
    const s = setup({ garden: [RESEARCH], reffLines: ['1. [sandbase-harness](https://github.com/sandbaseai/sandbase-harness) - [sandbaseai](https://github.com/sandbaseai)'] });
    const { snapshot } = buildSnapshot({ reffPath: s.reffPath, manifestPath: s.manifestPath, gardenPath: s.garden });
    const owned = snapshot.plugins.find((p: any) => p.group === 'owned')!;
    expect(owned.id).toBe('@local/dsh-research-preset');
    expect(owned.description).toBe('Read-only research agent');
    expect(owned.version).toBe('1.0.0');
    const external = snapshot.plugins.find((p: any) => p.group === 'external')!;
    expect(external.id).toBe('sandbase-harness');
  });

  it('owned rows reconcile by exact dep name (link species)', () => {
    const s = setup({ garden: [RESEARCH], reffLines: [], manifestDeps: { '@local/dsh-research-preset': 'link:/somewhere/plugins/dsh-research-preset' } });
    const { snapshot } = buildSnapshot({ reffPath: s.reffPath, manifestPath: s.manifestPath, gardenPath: s.garden });
    const owned = snapshot.plugins.find((p: any) => p.group === 'owned')!;
    expect(owned.installed).toBe(true);
    expect(owned.pkg).toBe('@local/dsh-research-preset');
  });

  it('external rows reconcile by owner-name tail', () => {
    const s = setup({ reffLines: ['1. [sandbase-harness](https://github.com/sandbaseai/sandbase-harness)'], manifestDeps: { 'sandbase-harness': 'github:sandbaseai/sandbase-harness' } });
    const { snapshot } = buildSnapshot({ reffPath: s.reffPath, manifestPath: s.manifestPath, gardenPath: join(home, 'garden') });
    const ext = snapshot.plugins.find((p: any) => p.group === 'external')!;
    expect(ext.installed).toBe(true);
  });
});
