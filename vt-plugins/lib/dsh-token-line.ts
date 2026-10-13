/**
 * dsh-token-line — extract the launch token from one host announce line.
 *
 * Pure by design and unit-tested per character class: a broken extraction
 * silently starves DSI of the token (the page 401s on every RPC) — bug
 * 2026-10-11, a split on /[s"']/ (lost backslash: literal letter s)
 * truncated any token containing "s", and only tokens without one worked.
 */

/** Extract the launch token from one host announce line, or null. The
 *  token is base64url-ish (letters, digits, - and _) and runs to end of
 *  line; the announce reads `dsh web: http://host:port/?token=<token>`. */
export function tokenFromLine(text: string): string | null {
  const idx = text.indexOf('token=');
  if (idx === -1 || !text.includes('dsh web: http')) return null;
  const m = /token=([A-Za-z0-9_-]+)/.exec(text.slice(idx));
  return m ? m[1] : null;
}
