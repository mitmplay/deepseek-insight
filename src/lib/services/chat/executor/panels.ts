/**
 * executor/panels — the six panel-opener verbs (terminal, prompts
 * manager, plugin rack, skill shelf, settings editors, loadinjected)
 * plus the addPanel test seam, moved whole from command-executor.ts
 * (thin batch R3 lane B, ADR-0019 move-whole / ADR-0022 W4): every wire
 * byte, error string, and note text is byte-identical. The shell's
 * executeCommand dispatches here; setAddPanelFromSidebarForTest stays
 * public through the shell's re-export.
 */

import {
	addPanelFromSidebar,
	replacePanelFromRegistry
} from '$lib/services/panels/panel-registry';
import { resolveInjectedMember } from '$lib/services/conversation/injected-shelf';
import type { ExecutorContext, ExecutorResult, NoteSink } from '../command-executor';

/** Test seam (Wave 3, skill-shelf): the executor reads the registry
 *  THROUGH this indirection so a unit test can capture add requests
 *  without the panel floor. Prod code never calls the setter. */
let addPanelOverride: ((request: Parameters<typeof addPanelFromSidebar>[0]) => void) | null = null;
export function setAddPanelFromSidebarForTest(
	fn: ((request: Parameters<typeof addPanelFromSidebar>[0]) => void) | null
): void {
	addPanelOverride = fn;
}
function addPanel(request: Parameters<typeof addPanelFromSidebar>[0]): boolean {
	if (addPanelOverride) {
		addPanelOverride(request);
		return true;
	}
	return addPanelFromSidebar(request);
}

/**
 * /dsi-prompts (re-pointed 2026-09-17, ADR The Focus Command D1/D2): AIM
 * the prompts manager panel from the composer — the floor's add path
 * FOCUSES the already-open manager (one live manager, D3) or opens a NEW
 * one right of this session's panel, selected. The bare successor-swap and
 * the --add flag are retired; the floor never replaces a panel for this
 * command. No wire call — the manager content talks to /api/prompts itself.
 */
/**
 * /dsi-terminal (Web Terminal spec Wave 5, 2026-09-24; widened by The
 * Terminal Desk ADR 2026-09-24 D2): aim the operator terminal desk — the
 * manager-request grammar. The enabled gate lives HERE (the composer gives
 * honest feedback even before a panel exists): a disabled flag notes the
 * fact and opens nothing. action carries the parser-admitted flag
 * ('new-tab' | 'split-down') onward — with no desk on the floor all three
 * shapes create the first tab; the action discriminates only when one exists.
 */
export async function runTerminal(
	args: string,
	action: 'new-tab' | 'split-down' | undefined,
	ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	if (args !== '') {
		const usage = 'usage: /dsi-terminal [--new-tab | --split-down]';
		onNote?.(false, usage);
		return { ok: false, note: usage };
	}
	if (ctx.panelId == null) {
		const note = '/dsi-terminal needs a panel floor (open this session on the floor first)';
		onNote?.(false, note);
		return { ok: false, note };
	}
	try {
		const probe = await fetch('/api/terminal');
		const body = (await probe.json()) as { enabled?: boolean };
		if (!body.enabled) {
			const note = '/dsi-terminal is disabled — set terminal.enabled in settings';
			onNote?.(false, note);
			return { ok: false, note };
		}
	} catch {
		// the probe failing must not block the open — the panel re-probes itself
	}
	const added = addPanelFromSidebar({
		kind: 'terminal',
		...(action ? { action } : {}),
		afterSessionId: ctx.sessionId
	});
	if (!added) {
		const note = '/dsi-terminal: the floor is not mounted';
		onNote?.(false, note);
		return { ok: false, note };
	}
	return { ok: true };
}

export async function runPromptManager(
	args: string,
	ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	if (args !== '') {
		const usage = 'usage: /dsi-prompts';
		onNote?.(false, usage);
		return { ok: false, note: usage };
	}
	if (ctx.panelId == null) {
		// Off-floor composer (the loupe, a macro without a floor): the
		// same honest no as /new — verbatim shape, own command name.
		const note = '/dsi-prompts needs a panel floor (open this session on the floor first)';
		onNote?.(false, note);
		return { ok: false, note };
	}
	const added = addPanelFromSidebar({
		kind: 'prompt-manager',
		afterSessionId: ctx.sessionId
	});
	if (!added) {
		const note = '/dsi-prompts: the floor is not mounted';
		onNote?.(false, note);
		return { ok: false, note };
	}
	// No note on success — the focused (or fresh) panel IS the feedback.
	return { ok: true };
}

/**
 * /dsi-skills (The Skill Shelf ADR, 2026-09-20, D1/D3): aim the
 * SettingsSkillsPanel — the floor dedupes and FOCUSES the open shelf
 * (the manager-request grammar). Snapshot-first is the ROUTE's contract
 * (GET /api/skills/snapshot builds when absent, D3); the '--reload' flag
 * forces the rebuild HERE so the panel's first fetch already carries the
 * fresh snapshot. No note on success — the focused panel IS the feedback.
 */

/**
 * /dsi-plugins (The Plugin Rack ADR, 2026-09-27, D1): aim the
 * PluginManagerPanel — the floor dedupes and FOCUSES the open rack (the
 * manager-request grammar). Snapshot-first is the ROUTE's contract
 * (GET /api/plugins/snapshot builds when absent, D2); the '--reload' flag
 * forces the rebuild HERE so the panel's first fetch already carries the
 * fresh snapshot. No note on success — the focused panel IS the feedback.
 */
export async function runPluginRack(
	args: string,
	reload: boolean,
	ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	// The parser's leftover-args rule (the shelf's grammar): the parser
	// keeps unknown args raw so this note can be honest about the grammar
	// instead of silently ignoring them.
	if (args !== '') {
		const usage = 'usage: /dsi-plugins [--reload]';
		onNote?.(false, usage);
		return { ok: false, note: usage };
	}
	if (ctx.panelId == null) {
		const note = '/dsi-plugins needs a panel floor (open this session on the floor first)';
		onNote?.(false, note);
		return { ok: false, note };
	}
	if (reload) {
		try {
			const res = await fetch('/api/plugins/reload', { method: 'POST' });
			if (!res.ok) {
				const note = '/dsi-plugins: snapshot rebuild failed (' + res.status + ')';
				onNote?.(false, note);
				return { ok: false, note };
			}
		} catch {
			const note = '/dsi-plugins: snapshot rebuild failed (network)';
			onNote?.(false, note);
			return { ok: false, note };
		}
	}
	const added = addPanel({
		kind: 'plugin-rack',
		afterSessionId: ctx.sessionId,
		// Same flag-rides rule as the shelf: an open rack must re-fetch.
		...(reload ? { reload: true } : {})
	});
	if (!added) {
		const note = '/dsi-plugins: the floor is not mounted';
		onNote?.(false, note);
		return { ok: false, note };
	}
	return { ok: true };
}

export async function runSkillShelf(
	args: string,
	reload: boolean,
	ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	// The parser's leftover-args rule (The Shelf Voice W1, RCA fix): the
	// parser keeps unknown args raw so this note can be honest about the
	// grammar instead of silently ignoring them.
	if (args !== '') {
		const usage = 'usage: /dsi-skills [--reload]';
		onNote?.(false, usage);
		return { ok: false, note: usage };
	}
	if (ctx.panelId == null) {
		const note = '/dsi-skills needs a panel floor (open this session on the floor first)';
		onNote?.(false, note);
		return { ok: false, note };
	}
	if (reload) {
		try {
			const res = await fetch('/api/skills/reload', { method: 'POST' });
			if (!res.ok) {
				const note = '/dsi-skills: snapshot rebuild failed (' + res.status + ')';
				onNote?.(false, note);
				return { ok: false, note };
			}
		} catch {
			const note = '/dsi-skills: snapshot rebuild failed (network)';
			onNote?.(false, note);
			return { ok: false, note };
		}
	}
	const added = addPanel({
		kind: 'skill-shelf',
		afterSessionId: ctx.sessionId,
		// BUG 2026-10-05: the open shelf dedupes to FOCUS and never
		// re-fetches — the flag must ride so the floor bumps its refresh.
		...(reload ? { reload: true } : {})
	});
	if (!added) {
		const note = '/dsi-skills: the floor is not mounted';
		onNote?.(false, note);
		return { ok: false, note };
	}
	return { ok: true };
}

/**
 * /dsi-settings and /dsh-settings (re-pointed by The Settings Tree ADR,
 * 2026-09-18, D2; aimed 2026-09-17, The Focus Command ADR D1): open a
 * SESSION-LESS workspace-explorer over the settings HOME folder (~/.dsi |
 * ~/.dsh), titled — one runner for both commands; the command name carries
 * the home. The floor's add path dedupes by root, so a repeat FOCUSES the
 * open home panel; the successor-swap and the --add flag are retired. No
 * wire call — the explorer content talks to the DSI-local
 * /api/settings-home routes itself.
 */
export async function runSettingsEditor(
	home: 'dsi' | 'dsh',
	commandName: string,
	args: string,
	ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	if (args !== '') {
		const usage = 'usage: ' + commandName;
		onNote?.(false, usage);
		return { ok: false, note: usage };
	}
	if (ctx.panelId == null) {
		const note = commandName + ' needs a panel floor (open this session on the floor first)';
		onNote?.(false, note);
		return { ok: false, note };
	}
	const added = addPanelFromSidebar({
		kind: 'settings-home',
		home,
		afterSessionId: ctx.sessionId
	});
	if (!added) {
		const note = commandName + ': the floor is not mounted';
		onNote?.(false, note);
		return { ok: false, note };
	}
	// No note on success — the focused (or fresh) panel IS the feedback.
	return { ok: true };
}

/**
 * /loadinjected — INTERNAL command (2026-09-17, The Retired Typed Command
 * ADR D1/D2; ex-/loadinjected <filename.md> [--add], The Loadinjected ADR
 * D2-D6): the shelf button composes it via the parser's
 * loadinjectedCommand() constructor — the typed surface is retired.
 *   filename present (the constructor's shape) → resolve as the
 *   Loadinjected ADR built it: member resolution rides the injected-shelf
 *   selector over ctx.entries — exact displayPath first, then a unique
 *   basename; the executor never re-implements it (D4). --add → a NEW
 *   panel BELOW this conversation's panel, selected (D3); bare → replaces
 *   the panel it ran in (D4). Dedupe→focus is the FLOOR handler's D5
 *   policy — the executor never pre-checks it (D6: one write path).
 *   filename absent (every TYPED shape) → the D2 retirement note pointing
 *   at the InjectedShelfButton — honest, never a silent unknown-command.
 *   No wire call — the payload is the record the panel reads at mount.
 */
export async function runLoadInjected(
	filename: string | undefined,
	addPanel: boolean,
	ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	if (filename === undefined) {
		// The D2 retirement guard: filename absent = a TYPED shape (the
		// constructor always supplies the filename) → the honest pointer.
		const note = '/loadinjected retired — open injected documents with the Injected button on the conversation anchor';
		onNote?.(false, note);
		return { ok: false, note };
	}
	if (ctx.panelId == null) {
		const note = '/loadinjected needs a panel floor (open this session on the floor first)';
		onNote?.(false, note);
		return { ok: false, note };
	}
	// D4 normalization: an operator PASTING a workspace-absolute path
	// (/ws/deepseek-insight/AGENTS.md) still resolves — strip the session
	// workspace prefix when it prefixes the token. Home-relative (~) and
	// already-relative tokens pass through (the shelf holds the harness's
	// printed names verbatim); an ambiguous basename still lands in the
	// honest candidates note.
	const token =
		ctx.workspace !== null && filename.startsWith(ctx.workspace + '/')
			? filename.slice(ctx.workspace.length + 1)
			: filename;
	const resolved = resolveInjectedMember(ctx.entries ?? [], token);
	if (!resolved.ok) {
		const note =
			resolved.candidates.length === 0
				? '/loadinjected: nothing was injected into this conversation yet'
				: '/loadinjected: no injected ' +
					filename +
					' here — the shelf holds: ' +
					resolved.candidates.map((m) => m.displayPath).join(', ');
		onNote?.(false, note);
		return { ok: false, note };
	}
	const request = {
		kind: 'injected-doc' as const,
		sourceSessionId: ctx.sessionId,
		displayPath: resolved.member.displayPath,
		afterSessionId: ctx.sessionId
	};
	if (addPanel) {
		const added = addPanelFromSidebar(request);
		if (!added) {
			const note = '/loadinjected: the floor is not mounted';
			onNote?.(false, note);
			return { ok: false, note };
		}
		// No note on success — the panel below the source IS the feedback.
		return { ok: true };
	}
	const swapped = replacePanelFromRegistry(ctx.panelId, request);
	if (!swapped) {
		const note = '/loadinjected: the floor is not mounted';
		onNote?.(false, note);
		return { ok: false, note };
	}
	// No note on success — the panel swap IS the feedback (/new's rule).
	return { ok: true };
}
