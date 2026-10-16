import { describe, expect, it } from 'vitest';
import { repoIdentity } from '../../../.agents/skills/dsi-plugin-rack/rack.mjs';

describe('repoIdentity (ADR-0016 D1 — repo identity is owner/repo)', () => {
  it('maps a repo root URL to owner/repo', () => {
    expect(repoIdentity('https://github.com/mitmplay/dsh-insight')).toBe('mitmplay/dsh-insight');
  });
  it('strips a /tree/<ref> browse subtree — same identity', () => {
    expect(repoIdentity('https://github.com/mitmplay/dsh-insight/tree/main/plugins')).toBe('mitmplay/dsh-insight');
  });
  it('strips deep branch paths (/tree/refs/heads/feat/x)', () => {
    expect(repoIdentity('https://github.com/mitmplay/dsh-insight/tree/refs/heads/feat/x/plugins')).toBe('mitmplay/dsh-insight');
  });
  it('strips a .git suffix and trailing slashes', () => {
    expect(repoIdentity('https://github.com/mitmplay/dsh-insight.git/')).toBe('mitmplay/dsh-insight');
  });
  it('keeps foreign repos distinct', () => {
    expect(repoIdentity('https://github.com/LayneChai/superpowers-dsh')).not.toBe(repoIdentity('https://github.com/mitmplay/dsh-insight'));
  });
  it('handles non-https input tails defensively', () => {
    expect(repoIdentity('github:mitmplay/dsh-insight')).toBe('mitmplay/dsh-insight');
    expect(repoIdentity('')).toBe('');
  });
});
