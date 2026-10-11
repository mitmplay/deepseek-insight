/**
 * command-executor — THE shared command/send surface (Prompt Macro ADR
 * D2, 2026-08-29): one module both the typed path (ConversationPanel) and
 * the macro runner call to execute a composer line. Extracted verbatim
 * from ConversationPanel.handleCommand (Wave 1 task 1.2) — every wire
 * byte, error string, and note text is byte-identical; the panel keeps
 * only its note banner + optimistic-bubble orchestration.
 *
 * Contract in: { sessionId, workspace, agent } context. Structured result
 * out: { ok, newSessionId?, note? } — ok=false always carries a human
 * note (fail-loud, the macro's D4 posture). The executor never renders;
 * callers decide what a note becomes (banner vs sheet).
 *
 * BC-2: client service — no $lib/server imports; every byte flows
 * through the /api/dsh/* + /api/prompts/* + /api/a2a/* routes.
 */

import { parseCommand } from './command-parser';
import { shouldRecordPrompt } from './prompt-trigger.js';
import { buildDeliveredText, mintA2aId } from './a2a-protocol';

import { runNewLine } from './executor/session';
import { runMention } from './executor/mention';
import { runPermissionLine, runWorkspaceLine } from './executor/workspace';

import { runTerminal, runPromptManager, runPluginRack, runSkillShelf, runSettingsEditor, runLoadInjected, setAddPanelFromSidebarForTest } from './executor/panels';

export { setAddPanelFromSidebarForTest };
import type { DsiCommandRow, DsiEntry } from '$lib/types';

/** Everything a line needs about the panel it ran from. */
export interface ExecutorContext {
	/** The DSH session the composer belongs to (mention `from`, sends). */
	sessionId: string;
	/** The session's workspace (cwd inheritance for /new); null = none. */
	workspace: string | null;
	/** Agent preset id (/new inheritance; @agent overrides); null = none. */
	agent: string | null;
	/** Owning floor panel id — /new's successor swap targets it; null
	 * outside a floor (the /new error is verbatim from the typed path). */
	panelId?: string | null;
	/** This conversation's dispatched transcript entries — the panel's
	 * store view, live at call time. /loadinjected resolves its member
	 * over them (ADR D4, through the injected-shelf selector); absent
	 * reads as an empty shelf (the honest no-match note). Optional so
	 * every existing caller literal compiles. */
	entries?: readonly DsiEntry[];
}

/** Structured outcome of one executed line (ADR D2). */
export interface ExecutorResult {
	/** True when the line fully succeeded (swap done, prompt queued). */
	ok: boolean;
	/** /new only — the successor session the panel must move onto. */
	newSessionId?: string;
	/** Human-readable outcome/failure reason (the typed path's banner
	 * text, verbatim; fail-loud note when ok=false). */
	note?: string;
}

/** Note sink fired at the typed path's exact noteCommand points — the
 *  mention path notes mid-flight (prompt receipt) and may replace the
 *  note later (register failure); callers that only need the final
 *  outcome read the ExecutorResult instead. */
export type NoteSink = (ok: boolean, note: string) => void;

/**
 * Send one ordinary prompt through the panel's submit path and record
 * the use (Suggest Strip ADR D5, moved verbatim): one fire-and-forget
 * /api/prompts/use per ADMITTED ORDINARY send — shouldRecordPrompt
 * excludes control traffic (`/ @ . ?` lines) and blanks. Failure never
 * blocks or retries (silent degrade, BC-5). The record guard runs ONLY
 * on the admitted-true path, exactly as the panel did.
 *
 * `submit` is the caller's submit function (the panel passes its
 * orchestrator's; the runner passes a plain POST) so this module stays
 * fetch-free on the prompt wire — one submit surface, no duplication.
 */
export async function sendPrompt(
	text: string,
	ctx: ExecutorContext,
	submit: (text: string) => Promise<boolean>
): Promise<ExecutorResult> {
	const admitted = await submit(text);
	if (admitted !== false && shouldRecordPrompt(text)) {
		void fetch('/api/prompts/use', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text })
		}).catch(() => {});
	}
	return admitted === false
		? { ok: false, note: 'prompt rejected — see the panel error banner' }
		: { ok: true };
}

/**
 * Execute one intercepted command line (/new, /permission, mention) —
 * the handleCommand body, moved verbatim from ConversationPanel
 * (2026-08-29, Wave 1 task 1.2): same fetches, same error strings, same
 * order of operations. `command` comes from parseCommand(line).
 */
export async function executeCommand(
	command: {
		type:
			| 'permission'
			| 'new'
			| 'workspace'
			| 'mention'
			| 'promptmanager'
			| 'terminal'
			| 'dsisettings'
			| 'dshsettings'
			| 'skillshelf'
			| 'pluginrack'
			| 'loadinjected';
		args: string;
		agentId?: string;
		/** /workspace only (2026-09-15, ADR D1/D2) — the parser's captured
		 *  path + optional name tokens (see ParsedCommand). */
		wsPath?: string;
		wsName?: string;
		/** /new only (2026-09-15, ADR D5) — the parser's workspace token. */
		ws?: string;
		/** /new only (2026-09-06) — the parser's --add flag (see ParsedCommand). */
		addPanel?: boolean;
		sessionId?: string;
		a2aId?: string;
		/** /loadinjected only (2026-09-07, ADR D4) — the parser's filename token. */
		filename?: string;
		/** /dsi-skills only (The Skill Shelf ADR, 2026-09-20, D3) — the
		 *  '--reload' flag: rebuild the snapshot before the shelf opens. */
		reload?: boolean;
		/** /dsi-terminal only (The Terminal Desk ADR, 2026-09-24, D2) — the
		 *  parser-admitted desk flag (see ParsedCommand). */
		terminalAction?: 'new-tab' | 'split-down';
	},
	ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	if (command.type === 'permission') {
		return runPermissionLine(`/permission${command.args === '' ? '' : ' ' + command.args}`, ctx, onNote);
	}
	if (command.type === 'workspace') {
		return runWorkspaceLine(command.wsPath, command.wsName, ctx, onNote);
	}
	if (command.type === 'mention') {
		return runMention(command.sessionId ?? '', command.args, command.a2aId, ctx, onNote);
	}
	if (command.type === 'promptmanager') {
		return runPromptManager(command.args, ctx, onNote);
	}
	if (command.type === 'terminal') {
		return runTerminal(command.args, command.terminalAction, ctx, onNote);
	}
	if (command.type === 'skillshelf') {
		return runSkillShelf(command.args, command.reload === true, ctx, onNote);
	}
	if (command.type === 'pluginrack') {
		return runPluginRack(command.args, command.reload === true, ctx, onNote);
	}
	if (command.type === 'dsisettings' || command.type === 'dshsettings') {
		return runSettingsEditor(
			command.type === 'dsisettings' ? 'dsi' : 'dsh',
			// display token renamed 2026-09-24 — the type stays the stable name
			command.type === 'dsisettings' ? '/dsi-settings' : '/dsh-settings',
			command.args,
			ctx,
			onNote
		);
	}
	if (command.type === 'loadinjected') {
		return runLoadInjected(command.filename, command.addPanel === true, ctx, onNote);
	}
	// /new
	return runNewLine(command, ctx, onNote);
}



// ── Slash Menu W1 (task 1.4) — the submit-ladder rung ──────────────────────

/**
 * The host-command rung of the submit ladder (Slash Menu ADR §3.4): a line
 * whose FIRST TOKEN names a row in the cached host command catalog executes
 * host-side instead of shipping to the model. Precedence is structural —
 * callers run the typed gestures (parseCommand) FIRST and consult this rung
 * only after the parser declines (Resolved decision 6); a name shared by a
 * command and a skill resolves to the COMMAND here because skills are never
 * passed to the ladder (the native adjudication, verbatim).
 *
 * Match semantics: case-insensitive EXACT first token (`/COMPACT` matches
 * `compact`; `/compacting` does not — never a prefix match). No vocabulary
 * is hardcoded here (ADR §4.2): the catalog argument is the wire-read cache.
 */
export function resolveHostCommand(line: string, catalog: readonly DsiCommandRow[]): DsiCommandRow | null {
	const first = line.trim().split(/\s+/, 1)[0] ?? '';
	if (!first.startsWith('/')) return null;
	const bare = first.slice(1);
	const token = bare.toLowerCase();
	if (token === '') return null;
	return catalog.find((row) => row.name.toLowerCase() === token) ?? null;
}

/**
 * Execute one host command through the native wire (POST …/command) — the
 * FULL line verbatim, arguments never re-parsed client-side (ADR §4.4).
 * Receipts are honest (Resolved decision 2):
 *   - success        → ok:true + the host's result text verbatim in the note
 *                      (the banner note IS the receipt — Resolved decision 5)
 *   - admission miss → {ok:true, executed:false} from the route → an HONEST
 *                      ok:false note here; the caller keeps the draft and
 *                      NEVER falls back to a model send (ADR §4.3 — the RCA
 *                      incident stays impossible)
 *   - command error / wire failure → ok:false + the route's message
 *
 * Menu picks and the panel's ladder submit call the SAME rung — one
 * execution surface for host commands (the D2 single-surface rule).
 */
export async function executeHostCommand(
	line: string,
	ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	try {
		const res = await fetch(`/api/dsh/session/${encodeURIComponent(ctx.sessionId)}/command`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ line })
		});
		const body = (await res.json().catch(() => null)) as
			| { ok?: boolean; executed?: boolean; text?: string; error?: { code?: string; message?: string } }
			| null;
		if (body?.ok === true && body.executed === true) {
			const note = body.text ?? 'command executed';
			onNote?.(true, note);
			return { ok: true, note };
		}
		if (body?.ok === true && body.executed === false) {
			// Admission miss — honest note, draft kept (ok:false tells the caller
			// to keep it; no model send ever happens inside this rung).
			const note = `unknown command: ${line.trim().split(/\s+/, 1)[0] ?? ''} — nothing was sent`;
			onNote?.(false, note);
			return { ok: false, note };
		}
		const note = body?.error?.message ?? `command failed (HTTP ${res.status})`;
		onNote?.(false, note);
		return { ok: false, note };
	} catch (err) {
		const note = `command failed (${err instanceof Error ? err.message : String(err)})`;
		onNote?.(false, note);
		return { ok: false, note };
	}
}

