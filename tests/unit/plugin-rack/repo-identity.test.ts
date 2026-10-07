import { describe, expect, it } from 'vitest';
import { repoIdentity } from '../../../.agents/skills/dsi-plugin-rack/rack.mjs';

describe('repoIdentity (ADR-0016 D1 — repo identity is owner/repo)', () => {
  it('maps a repo root URL to owner/repo', () => {
    expect(repoIdentity('https://github.com/mitmplay/deepseek-insight')).toBe('mitmplay/deepseek-insight');
  });
  it('strips a /tree/<ref> browse subtree — same identity', () => {
    expect(repoIdentity('https://github.com/mitmplay/deepseek-insight/tree/main/plugins')).toBe('mitmplay/deepseek-insight');
  });
  it('strips deep branch paths (/tree/refs/heads/feat/x)', () => {
    expect(repoIdentity('https://github.com/mitmplay/deepseek-insight/tree/refs/heads/feat/x/plugins')).toBe('mitmplay/deepseek-insight');
  });
  it('strips a .git suffix and trailing slashes', () => {
    expect(repoIdentity('https://github.com/mitmplay/deepseek-insight.git/')).toBe('mitmplay/deepseek-insight');
  });
  it('keeps foreign repos distinct', () => {
    expect(repoIdentity('https://github.com/LayneChai/superpowers-dsh')).not.toBe(repoIdentity('https://github.com/mitmplay/deepseek-insight'));
  });
  it('handles non-https input tails defensively', () => {
    expect(repoIdentity('github:mitmplay/deepseek-insight')).toBe('mitmplay/deepseek-insight');
    expect(repoIdentity('')).toBe('');
  });
});
