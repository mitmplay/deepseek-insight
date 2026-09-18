/**
 * The running app's versions at build time — package.json is the ONE
 * source (new surfaces that name a build import this module, never
 * package.json directly):
 *   - APP_VERSION — DSI's own "version".
 *   - DSH_VERSION — the pinned DSH web release ("dsh"."webVersion",
 *     the dsi dsh --sync pin).
 * The sidebar title prefixes APP_VERSION (v${APP_VERSION} - Deepseek
 * Insight) so a screenshot or copy identifies the edition.
 */
import { version, dsh } from '../../package.json';

export const APP_VERSION: string = version;
export const DSH_VERSION: string = dsh.webVersion;
