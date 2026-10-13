// @vitest-environment node
/**
 * bounce-inspect — parseInspectArgsFromEnv pins (ADR 2026-10-13 "The
 * Faithful Bounce", D3/D5): the bounce CLI reads the launcher-stamped
 * DSI_INSPECT_ARGS out of the dying floor's ps -E dump, exactly the
 * channel resolveBounceMode already uses for the mode enum (D6).
 */
import { describe, expect, it } from 'vitest';
import { parseInspectArgsFromEnv } from '../../bin/lib/dev-mode.mjs';

const dumpWith = 'TERM=xterm PATH=/usr/bin DSI_DEV=1 DSI_DEV_MODE=in-process DSI_INSPECT_ARGS=--inspect=127.0.0.1:9229 --inspect-brk HOME=/Users/x';
const dumpPlain = 'TERM=xterm PATH=/usr/bin DSI_DEV=1 DSI_DEV_MODE=pair HOME=/Users/x';

describe('parseInspectArgsFromEnv', () => {
  it('extracts space-joined flags from a ps -E dump, order preserved', () => {
    expect(parseInspectArgsFromEnv(dumpWith)).toEqual(['--inspect=127.0.0.1:9229', '--inspect-brk']);
  });
  it('a dump without the marker yields no flags (pre-stamp floor)', () => {
    expect(parseInspectArgsFromEnv(dumpPlain)).toEqual([]);
    expect(parseInspectArgsFromEnv('')).toEqual([]);
    expect(parseInspectArgsFromEnv(undefined as unknown as string)).toEqual([]);
  });
  it('a substring marker is not a match (DSI_INSPECT_ARGS_X)', () => {
    expect(parseInspectArgsFromEnv('DSI_INSPECT_ARGS_X=--inspect DSI_DEV_MODE=in-process')).toEqual([]);
  });
  it('an empty or whitespace-only value is no flags', () => {
    expect(parseInspectArgsFromEnv('DSI_INSPECT_ARGS= HOME=/x')).toEqual([]);
    expect(parseInspectArgsFromEnv('DSI_INSPECT_ARGS=   HOME=/x')).toEqual([]);
  });
  it('the value ends at the newline, never eats the next KEY=VALUE', () => {
    expect(parseInspectArgsFromEnv('A=1\nDSI_INSPECT_ARGS=--inspect --inspect-brk\nHOME=/x')).toEqual(['--inspect', '--inspect-brk']);
  });
});
