import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installOwned, restoreClobberedBundles } from '../../../.agents/skills/dsi-plugin-rack/rack.mjs';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pgr-install-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function writeManifest(deps: Record<string, string>, bundles: string[]) {
  const manifestPath = join(home, 'package.json');
  writeFileSync(manifestPath, JSON.stringify({ name: 'dsh-profile-web', private: true, dsh: { profile: { bundles } }, dependencies: deps }, null, 2));
  return manifestPath;
}

const ROW = { id: '@local/dsh-research-preset', group: 'owned', installSpec: 'link:/Users/x/deepseek-insight/plugins/dsh-research-preset' };

describe('installOwned (2.2 owned species)', () => {
  it('writes the link dep, appends exactly one bundle, idempotent on re-run', () => {
    const manifestPath = writeManifest({}, []);
    installOwned(manifestPath, ROW as any);
    let doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(doc.dependencies[ROW.id]).toBe(ROW.installSpec);
    expect(doc.dsh.profile.bundles.filter((b: string) => b === ROW.id)).toHaveLength(1);
    // idempotent re-run
    installOwned(manifestPath, ROW as any);
    doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(doc.dsh.profile.bundles.filter((b: string) => b === ROW.id)).toHaveLength(1);
  });

  it('preserves existing deps and bundles when appending', () => {
    const manifestPath = writeManifest({ 'sandbase-harness': 'github:sandbaseai/sandbase-harness' }, ['sandbase-harness', '@local/dsh-app-dev-preset']);
    installOwned(manifestPath, ROW as any);
    const doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(doc.dependencies['sandbase-harness']).toBe('github:sandbaseai/sandbase-harness');
    expect(doc.dsh.profile.bundles).toContain('sandbase-harness');
    expect(doc.dsh.profile.bundles).toContain(ROW.id);
  });
});

describe('restoreClobberedBundles (2.2 clobber guard)', () => {
  it('re-appends bundle entries and dep entries dropped by a plugin add', () => {
    const manifestPath = writeManifest({ '@deepseek-insight/dsi': 'github:mitmplay/deepseek-insight#main' }, ['@deepseek-insight/dsi']);
    const preOwned = [
      { id: '@local/dsh-app-dev-preset', group: 'owned', installSpec: 'link:/Users/x/plugins/dsh-app-dev-preset', pkg: '@local/dsh-app-dev-preset' },
      { id: '@local/dsh-research-preset', group: 'owned', installSpec: 'link:/Users/x/plugins/dsh-research-preset', pkg: '@local/dsh-research-preset' }
    ];
    restoreClobberedBundles(manifestPath, preOwned as any);
    const doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(doc.dsh.profile.bundles).toContain('@local/dsh-app-dev-preset');
    expect(doc.dsh.profile.bundles).toContain('@local/dsh-research-preset');
    expect(doc.dependencies['@local/dsh-app-dev-preset']).toBeTruthy();
    // the clobbering install survives
    expect(doc.dependencies['@deepseek-insight/dsi']).toBeTruthy();
  });

  it('does nothing when nothing was dropped', () => {
    const manifestPath = writeManifest({ '@local/dsh-app-dev-preset': 'link:/x' }, ['@local/dsh-app-dev-preset']);
    const preOwned = [{ id: '@local/dsh-app-dev-preset', group: 'owned', installSpec: 'link:/x', pkg: '@local/dsh-app-dev-preset' }];
    restoreClobberedBundles(manifestPath, preOwned as any);
    const doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(doc.dsh.profile.bundles).toEqual(['@local/dsh-app-dev-preset']);
  });
});
