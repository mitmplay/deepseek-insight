import { describe, expect, it } from 'vitest';
import { parseReff } from '../../../.agents/skills/dsi-plugin-rack/rack.mjs';

describe('reff demoted to external catalog (2.1)', () => {
  it('parses external-only reff lines clean', () => {
    const text = [
      'Plugins Resources:',
      '1. [superpowers-dsh](https://github.com/LayneChai/superpowers-dsh) - [LayneChai](https://github.com/LayneChai)',
      '2. [dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) - [NanmiCoder](https://github.com/NanmiCoder)'
    ].join('\n');
    const { plugins, warnings } = parseReff(text);
    expect(plugins).toHaveLength(2);
    expect(warnings).toHaveLength(0);
    expect(plugins[0].id).toBe('superpowers-dsh');
  });

  it('an owned-repo line, if present, still resolves (back-compat)', () => {
    const text = '1. [app-dev](https://github.com/mitmplay/deepseek-insight)';
    const { plugins, warnings } = parseReff(text);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].repo).toBe('https://github.com/mitmplay/deepseek-insight');
    expect(warnings).toHaveLength(0);
  });

  it('a /tree/ browse URL line still parses (engine normalizes at match time)', () => {
    const text = '1. [app-dev](https://github.com/mitmplay/deepseek-insight/tree/main/plugins/dsh-app-dev-preset)';
    const { plugins } = parseReff(text);
    expect(plugins[0].repo).toContain('/tree/main/');
  });
});
