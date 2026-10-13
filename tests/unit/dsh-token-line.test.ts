import { describe, it, expect } from 'vitest';
import { tokenFromLine } from '../../vt-plugins/lib/dsh-token-line.ts';

// Character-class regression for bug 2026-10-11: the old extractor split
// on /[s"']/ (lost backslash → literal letter s), truncating any token
// containing "s". Tokens are base64url-ish: letters, digits, - and _.
const line = (t: string) => `dsh web: http://127.0.0.1:3080/?token=${t}`;

describe('tokenFromLine', () => {
  it('extracts a token containing the letter s (the bug class)', () => {
    expect(tokenFromLine(line('sDhuu32do8N3apj'))).toBe('sDhuu32do8N3apj');
  });

  it('extracts a token starting with s', () => {
    expect(tokenFromLine(line('startsshere'))).toBe('startsshere');
  });

  it('extracts a token without s (the old lucky path)', () => {
    expect(tokenFromLine(line('I9VUK0DG-bG1PShpVre2xlyq'))).toBe('I9VUK0DG-bG1PShpVre2xlyq');
  });

  it('keeps - and _ characters to the end of the token', () => {
    expect(tokenFromLine(line('a-b_c-d_e'))).toBe('a-b_c-d_e');
  });

  it('stops at quotes, whitespace, and backslash (non-token chars)', () => {
    expect(tokenFromLine(line('abc"def'))).toBe('abc');
    expect(tokenFromLine(line('abc def'))).toBe('abc');
  });

  it('ignores lines without the announce marker', () => {
    expect(tokenFromLine('GET /?token=abc')).toBeNull();
  });

  it('ignores announce lines without a token', () => {
    expect(tokenFromLine('dsh web: http://127.0.0.1:3080/')).toBeNull();
  });

  it('returns null for non-announce text', () => {
    expect(tokenFromLine('VITE ready in 2097 ms')).toBeNull();
  });
});
