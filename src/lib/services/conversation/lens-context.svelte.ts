/**
 * Panel Lens Context — Svelte 5 Context API for the `lens` flag
 * (The Panel Loupe ADR D8, 2026-09-04).
 *
 * The flag means: this mount is the loupe's copy of a floor panel, so
 * floor-identity verbs render VISIBLE-DISABLED — the prompt-sync check,
 * the fork family, the move chevrons, and the panel close all read it at
 * their init (their meaning depends on being THE floor panel; reading and
 * composing stay live). PanelLoupe sets it once during init, before
 * rendering its children snippet; the controls read it at their own init.
 * Returns false when no provider is present — the correct default for
 * every existing floor/standalone mount and for unit tests.
 *
 * Portal note: the loupe's DOM is portaled to document.body, but context
 * follows the COMPONENT tree, not the DOM tree — snippet content rendered
 * inside PanelLoupe keeps the flag after the move (asserted by the loupe
 * unit tests, not assumed).
 */

import { setContext, getContext } from 'svelte';

const PANEL_LENS_KEY = Symbol('dsi-panel-lens');

/**
 * Set the lens flag in context. Called once by PanelLoupe during init,
 * before rendering children. `true` = the loupe's mount (floor verbs
 * render visible-disabled), `false` = a floor or standalone mount.
 */
export function setLensMode(embedded: boolean): void {
	setContext(PANEL_LENS_KEY, embedded);
}

/**
 * Read the lens flag from context. Returns `false` when no provider is
 * present (floor mounts, standalone mounts, tests).
 */
export function getLensMode(): boolean {
	return getContext<boolean>(PANEL_LENS_KEY) ?? false;
}
