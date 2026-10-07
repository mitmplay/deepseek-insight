import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanGarden } from '../../../.agents/skills/dsi-plugin-rack/rack.mjs';

let garden: string;

beforeEach(() => {
  garden = mkdtempSync(join(tmpdir(), 'pgr-garden-'));
});

afterEach(() => {
  rmSync(garden, { recursive: true, force: true });
});

function makePlugin(dir: string, opts: { name: string; version?: string; description?: string; withPatch?: boolean; rack?: object }) {
  mkdirSync(join(garden, dir), { recursive: true });
  const pkg: Record<string, unknown> = { name: opts.name, version: opts.version ?? '1.0.0', private: true };
  if (opts.description) pkg.description = opts.description;
  if (opts.withPatch !== false) {
    (pkg as any).dsh = { bundle: { patch: './cordis.patch.yml' }, ...(opts.rack ? { rack: opts.rack } : {}) };
  }
  writeFileSync(join(garden, dir, 'package.json'), JSON.stringify(pkg, null, 2));
}

describe('scanGarden (owned-species enumeration)', () => {
  it('yields one owned row per child with package.json wiring dsh.bundle.patch', () => {
    makePlugin('dsh-research-preset', { name: '@local/dsh-research-preset', description: 'Read-only research agent' });
    makePlugin('dsh-app-dev-preset', { name: '@local/dsh-app-dev-preset', description: 'Full application-development agent' });
    const rows = scanGarden(garden);
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.id)).toContain('@local/dsh-research-preset');
    expect(rows.every((r: any) => r.group === 'owned')).toBe(true);
    expect(rows.every((r: any) => r.installSpec.startsWith('link:'))).toBe(true);
  });

  it('skips children without a dsh.bundle.patch wiring', () => {
    makePlugin('dsh-research-preset', { name: '@local/dsh-research-preset', withPatch: false });
    makePlugin('dsh-app-dev-preset', { name: '@local/dsh-app-dev-preset', withPatch: false });
    mkdirSync(join(garden, 'not-a-plugin'));
    const rows = scanGarden(garden);
    expect(rows).toHaveLength(0);
  });

  it('orders rows by dsh.rack.order then falls back to name', () => {
    makePlugin('b-second', { name: '@local/b', rack: { order: 20 } });
    makePlugin('a-first', { name: '@local/a', rack: { order: 10 } });
    makePlugin('c-unordered', { name: '@local/c' });
    const rows = scanGarden(garden);
    expect(rows.map((r: any) => r.id)).toEqual(['@local/a', '@local/b', '@local/c']);
  });

  it('carries version and description from the package.json', () => {
    makePlugin('dsh-research-preset', { name: '@local/dsh-research-preset', version: '1.0.0', description: 'Read-only research agent' });
    const rows = scanGarden(garden);
    expect(rows[0].version).toBe('1.0.0');
    expect(rows[0].description).toBe('Read-only research agent');
  });

  it('returns an empty list for a missing garden directory', () => {
    expect(scanGarden(join(garden, 'does-not-exist'))).toEqual([]);
  });
});
