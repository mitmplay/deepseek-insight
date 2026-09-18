/**
 * Panel Mode Context — Svelte 5 Context API for the `embedded` flag
 * (OCI panel-context port, 2026-08-24 — FloatingAnchor per-panel fix).
 *
 * The floor's ConversationPanel calls setPanelMode(true) at init; any
 * descendant (FloatingAnchor) calls getPanelMode() to learn whether it
 * must anchor to the panel (absolute) or the viewport (fixed). Returns
 * false (standalone) when no provider is present — the correct default
 * for non-panel contexts and unit tests.
 */

import { setContext, getContext } from 'svelte';

const PANEL_MODE_KEY = Symbol('dsi-panel-mode');

/**
 * Set the panel mode in context. Called once by ConversationPanel.
 * `true` = embedded (a panel on the conversation floor), `false` = standalone.
 */
export function setPanelMode(embedded: boolean): void {
	setContext(PANEL_MODE_KEY, embedded);
}

/**
 * Read the panel mode from context. Returns `false` when no provider
 * is present (standalone mode, tests, non-panel contexts).
 */
export function getPanelMode(): boolean {
	return getContext<boolean>(PANEL_MODE_KEY) ?? false;
}
