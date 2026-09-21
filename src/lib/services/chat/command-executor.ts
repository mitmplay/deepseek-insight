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
import { addPanelFromSidebar, replacePanelBySession, replacePanelFromRegistry } from '$lib/services/panels/panel-registry';

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
import { resolveInjectedMember } from '$lib/services/conversation/injected-shelf';
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
			| 'dsisettings'
			| 'dshsettings'
			| 'skillshelf'
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
		/** /dsi-skill-shelf only (The Skill Shelf ADR, 2026-09-20, D3) — the
		 *  '--reload' flag: rebuild the snapshot before the shelf opens. */
		reload?: boolean;
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
	if (command.type === 'skillshelf') {
		return runSkillShelf(command.args, command.reload === true, ctx, onNote);
	}
	if (command.type === 'dsisettings' || command.type === 'dshsettings') {
		return runSettingsEditor(
			command.type === 'dsisettings' ? 'dsi' : 'dsh',
			'/' + command.type,
			command.args,
			ctx,
			onNote
		);
	}
	if (command.type === 'loadinjected') {
		return runLoadInjected(command.filename, command.addPanel === true, ctx, onNote);
	}
	// /new
	if (command.args !== '') {
		const usage = 'usage: /new [@agent] [workspace] [--add]';
		onNote?.(false, usage);
		return { ok: false, note: usage };
	}
	if (ctx.panelId == null) {
		const note = '/new needs a panel floor (open this session on the floor first)';
		onNote?.(false, note);
		return { ok: false, note };
	}
	// Workspace token (2026-09-15, The Workspace Command ADR D5): resolve
	// against the host registry BEFORE any create — a unique registry TITLE
	// match wins, then an exact canonical-PATH match; an ambiguous title is
	// a candidates note (path + title), never a guess; a miss is an honest
	// note pointing back at /workspace. A resolution REPLACES the inherited
	// cwd in the create body (the named workspace replaces inheritance).
	let cwd = ctx.workspace;
	if (command.ws !== undefined) {
		const resolved = await resolveWorkspaceToken(command.ws);
		if (resolved.note !== undefined) {
			onNote?.(false, resolved.note);
			return { ok: false, note: resolved.note };
		}
		cwd = resolved.path ?? null;
	}
	// Fresh-install marker (2026-09-15, ADR F11): no current workspace AND
	// no ws token — the session is about to land on the host default cwd,
	// ungrouped. The note rides the SUCCESS returns only.
	const freshInstallNote =
		cwd === null
			? '/new: no workspace inherited — this session lands UNGROUPED; adopt one with /workspace <full-path>, then aim with /new <name>'
			: undefined;
	// Preset override (2026-08-26): `/new @<id>` swaps the agent for the
	// successor; absent keeps the inheritance. The host validates the id
	// (agent-preset/not-found on a miss) — never a client-side catalog.
	const preset = command.agentId ?? ctx.agent;
	try {
		const res = await fetch('/api/dsh/sessions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			// Workspace + preset inheritance — the sidebar '+ New chat'
			// contract (2026-08-23): the new session lands in the same
			// project and the same agent; @agent overrides the agent. A D5
			// resolution (above) displaces the inherited cwd.
			body: JSON.stringify({
				...(cwd !== null ? { cwd } : {}),
				...(preset !== null ? { agentPreset: preset } : {})
			})
		});
		const body = (await res.json().catch(() => null)) as
			| { ok?: boolean; sessionId?: string; error?: { message?: string } }
			| null;
		if (!res.ok || body?.ok !== true || typeof body.sessionId !== 'string') {
			const note = body?.error?.message ?? `/new failed (HTTP ${res.status})`;
			onNote?.(false, note);
			return { ok: false, note };
		}
		// --add (2026-09-06): the new session opens in a NEW panel to the
		// RIGHT of the current panel (afterSessionId anchors it under this
		// session — a click during the async create cannot move the
		// anchor) and the selection STAYS here (keepSelection — the
		// composer keeps the caret; the swap path below never runs).
		if (command.addPanel === true) {
			const added = addPanelFromSidebar({
				sessionId: body.sessionId,
				agentPreset: preset,
				afterSessionId: ctx.sessionId,
				keepSelection: true
			});
			if (!added) {
				const note = '/new: the floor is not mounted';
				onNote?.(false, note);
				return { ok: false, note };
			}
			// Fresh install (2026-09-15, ADR F11): no inherited workspace and
			// no ws token — the create SUCCEEDED on the host default cwd, but
			// the session lands ungrouped and the operator deserves the map.
			if (freshInstallNote !== undefined) {
				onNote?.(true, freshInstallNote);
				return { ok: true, newSessionId: body.sessionId, note: freshInstallNote };
			}
			return { ok: true, newSessionId: body.sessionId };
		}
		const swapped =
			// Session-addressed swap first (Sectioned Row W3 2026-08-29): a
			// macro run that /new-retargets holds its context by SESSION — the
			// birth panel id died at the FIRST swap (fresh id + remount), so an
			// id-addressed replace would silently no-op the second one.
			replacePanelBySession(ctx.sessionId, {
				sessionId: body.sessionId,
				agentPreset: preset,
				focus: true
			}) ||
			// Typed-path fallback: the birth panel id is live on a first /new.
			(ctx.panelId != null &&
				replacePanelFromRegistry(ctx.panelId, {
				sessionId: body.sessionId,
				agentPreset: preset,
				focus: true
			})) ||
			false;
		if (!swapped) {
			const note = '/new: the floor is not mounted';
			onNote?.(false, note);
			return { ok: false, note };
		}
		// No note on success — the panel swap IS the feedback. Exception
		// (2026-09-15, ADR F11): a fresh install (no inherited workspace, no
		// ws token) landed UNGROUPED — the note is the map out.
		if (freshInstallNote !== undefined) {
			onNote?.(true, freshInstallNote);
			return { ok: true, newSessionId: body.sessionId, note: freshInstallNote };
		}
		return { ok: true, newSessionId: body.sessionId };
	} catch (err) {
		const note = `/new failed (${err instanceof Error ? err.message : String(err)})`;
		onNote?.(false, note);
		return { ok: false, note };
	}
}

/**
 * /promptmanager (re-pointed 2026-09-17, ADR The Focus Command D1/D2): AIM
 * the prompts manager panel from the composer — the floor's add path
 * FOCUSES the already-open manager (one live manager, D3) or opens a NEW
 * one right of this session's panel, selected. The bare successor-swap and
 * the --add flag are retired; the floor never replaces a panel for this
 * command. No wire call — the manager content talks to /api/prompts itself.
 */
async function runPromptManager(
	args: string,
	ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	if (args !== '') {
		const usage = 'usage: /promptmanager';
		onNote?.(false, usage);
		return { ok: false, note: usage };
	}
	if (ctx.panelId == null) {
		// Off-floor composer (the loupe, a macro without a floor): the
		// same honest no as /new — verbatim shape, own command name.
		const note = '/promptmanager needs a panel floor (open this session on the floor first)';
		onNote?.(false, note);
		return { ok: false, note };
	}
	const added = addPanelFromSidebar({
		kind: 'prompt-manager',
		afterSessionId: ctx.sessionId
	});
	if (!added) {
		const note = '/promptmanager: the floor is not mounted';
		onNote?.(false, note);
		return { ok: false, note };
	}
	// No note on success — the focused (or fresh) panel IS the feedback.
	return { ok: true };
}

/**
 * /dsi-skill-shelf (The Skill Shelf ADR, 2026-09-20, D1/D3): aim the
 * SettingsSkillsPanel — the floor dedupes and FOCUSES the open shelf
 * (the manager-request grammar). Snapshot-first is the ROUTE's contract
 * (GET /api/skills/snapshot builds when absent, D3); the '--reload' flag
 * forces the rebuild HERE so the panel's first fetch already carries the
 * fresh snapshot. No note on success — the focused panel IS the feedback.
 */
async function runSkillShelf(
	args: string,
	reload: boolean,
	ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	// The parser's leftover-args rule (The Shelf Voice W1, RCA fix): the
	// parser keeps unknown args raw so this note can be honest about the
	// grammar instead of silently ignoring them.
	if (args !== '') {
		const usage = 'usage: /dsi-skill-shelf [--reload]';
		onNote?.(false, usage);
		return { ok: false, note: usage };
	}
	if (ctx.panelId == null) {
		const note = '/dsi-skill-shelf needs a panel floor (open this session on the floor first)';
		onNote?.(false, note);
		return { ok: false, note };
	}
	if (reload) {
		try {
			const res = await fetch('/api/skills/reload', { method: 'POST' });
			if (!res.ok) {
				const note = '/dsi-skill-shelf: snapshot rebuild failed (' + res.status + ')';
				onNote?.(false, note);
				return { ok: false, note };
			}
		} catch {
			const note = '/dsi-skill-shelf: snapshot rebuild failed (network)';
			onNote?.(false, note);
			return { ok: false, note };
		}
	}
	const added = addPanel({
		kind: 'skill-shelf',
		afterSessionId: ctx.sessionId
	});
	if (!added) {
		const note = '/dsi-skill-shelf: the floor is not mounted';
		onNote?.(false, note);
		return { ok: false, note };
	}
	return { ok: true };
}

/**
 * /dsisettings and /dshsettings (re-pointed by The Settings Tree ADR,
 * 2026-09-18, D2; aimed 2026-09-17, The Focus Command ADR D1): open a
 * SESSION-LESS workspace-explorer over the settings HOME folder (~/.dsi |
 * ~/.dsh), titled — one runner for both commands; the command name carries
 * the home. The floor's add path dedupes by root, so a repeat FOCUSES the
 * open home panel; the successor-swap and the --add flag are retired. No
 * wire call — the explorer content talks to the DSI-local
 * /api/settings-home routes itself.
 */
async function runSettingsEditor(
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
async function runLoadInjected(
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

/**
 * @session-… mention (2026-08-26, KB "Talking to Another Agent"): deliver
 * the message to ANOTHER session as a queued prompt and open its panel —
 * the reply surface (its approval cards render there; a whisper to an
 * unseen session stalls silently). Same handler grammar as the live
 * delegation the KB note documents: look (spine) → open (panel) → send
 * (queue, never steer) → honest note. Guardrails per the note: usage,
 * self-mention no-op, unknown id sends NOTHING, replies are never
 * auto-forwarded anywhere (one hop, one human).
 */
async function runMention(
	capturedId: string,
	text: string,
	a2aId: string | undefined,
	ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	if (text === '') {
		return { ok: false, note: 'usage: @<session-id> <message> — the message is empty' };
	}
	// Self-mention (uuid-tail match — this panel's id may carry the
	// 'session-' prefix, the captured token never does): just talk.
	if (ctx.sessionId.replace(/^session-/, '') === capturedId) {
		return { ok: true, note: 'that is this session — just type your message' };
	}
	// Look before you talk: the spine row canonicalizes the id and
	// carries the title/preset/running bits the rest needs.
	type MentionRow = {
		sessionId: string;
		title: string | null;
		agentPreset: string | null;
		running: boolean;
		turns: number | null;
	};
	let row: MentionRow | null = null;
	try {
		const res = await fetch('/api/dsh/sessions');
		if (res.ok) {
			const body = (await res.json().catch(() => null)) as {
				ok?: boolean;
				sessions?: Array<Record<string, unknown>>;
			} | null;
			if (body?.ok === true && Array.isArray(body.sessions)) {
				const found = body.sessions.find(
					(s) => typeof s.sessionId === 'string' && s.sessionId.replace(/^session-/, '') === capturedId
				);
				row = found
					? {
							sessionId: found.sessionId as string,
							title: (found.title as string | null | undefined) ?? null,
							agentPreset: (found.agentPreset as string | null | undefined) ?? null,
							running: found.running === true,
							turns: typeof found.turns === 'number' ? found.turns : null
						}
					: null;
			}
		}
	} catch {
		// Network/spine failure — an honest retry note, not "no such
		// session" (that would be a fib about a list we never saw).
		return { ok: false, note: 'session list unavailable — try again' };
	}
	if (row === null) {
		return { ok: false, note: `no such session: ${capturedId} — nothing was sent` };
	}
	// Mention ⇒ panel: the floor owner opens (or selects) the target's
	// panel — dedupe→select is its policy; no floor mounted is a hard no.
	const opened = addPanelFromSidebar({
		sessionId: row.sessionId,
		agentPreset: row.agentPreset
	});
	if (!opened) {
		return {
			ok: false,
			note: '@session needs the panel floor (open this session on the floor first)'
		};
	}
	// Deliver — queue mode by design (stealing a running turn via steer
	// stays an explicit human choice, never a side effect). The delivered
	// text carries the a2a protocol line (Task 3.3): strip any leading
	// signature token, inject the Trial-B instruction for the id the
	// ledger will track (minted here when the composer carried none).
	const signatureId = a2aId ?? mintA2aId();
	const delivered = buildDeliveredText(text, signatureId);
	try {
		const res = await fetch(`/api/dsh/session/${encodeURIComponent(row.sessionId)}/prompt`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: delivered })
		});
		const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
		if (!res.ok || body?.ok !== true) {
			return { ok: false, note: body?.error?.message ?? `mention failed (HTTP ${res.status})` };
		}
		const label = row.title ?? row.sessionId;
		// Note fires AT the receipt — the typed path's exact point (the
		// banner shows "sent/queued" one fetch before the register lands).
		onNote?.(
			true,
			row.running
				? `queued behind ${label}'s current turn — panel opened`
				: `sent to ${label} — panel opened`
		);
		// Register the watch AFTER the receipt (prompt first, register
		// second — the order is the contract; Task 3.3). Watermark = the
		// spine row's turns at send; turns null → -1 + honest note.
		if (row.turns === null) {
			onNote?.(
				true,
				`${row.running ? `queued behind ${label}` : `sent to ${label}`} — untracked watermark: the spine row carries no turns count`
			);
		}
		try {
			const reg = await fetch('/api/a2a/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					from: ctx.sessionId,
					to: row.sessionId,
					message: text,
					watermark: row.turns ?? -1,
					id: signatureId
				})
			});
			const regBody = (await reg.json().catch(() => null)) as { ok?: boolean } | null;
			if (!reg.ok || regBody?.ok !== true) {
				// Send already happened — honest, not silent (Task 3.3). The
				// typed path REPLACED the ok note with this standalone error
				// text — same bytes, same point.
				onNote?.(false, 'sent, but untracked — the delegation ledger is unavailable');
				return { ok: true, note: 'sent, but untracked — the delegation ledger is unavailable' };
			}
		} catch {
			onNote?.(false, 'sent, but untracked — the delegation ledger is unavailable');
			return { ok: true, note: 'sent, but untracked — the delegation ledger is unavailable' };
		}
		if (row.turns === null) {
			return {
				ok: true,
				note: `${row.running ? `queued behind ${label}` : `sent to ${label}`} — untracked watermark: the spine row carries no turns count`
			};
		}
		return {
			ok: true,
			note: row.running
				? `queued behind ${label}'s current turn — panel opened`
				: `sent to ${label} — panel opened`
		};
	} catch (err) {
		return { ok: false, note: `mention failed (${err instanceof Error ? err.message : String(err)})` };
	}
}

/**
 * Execute one /permission… line through the typed route (commands/
 * execute host-side — never the model) and surface the host's own reply
 * text in the note. Bare /permission prints the current preset; an
 * error result (unknown preset, blocked downgrade) reports verbatim.
 * The null-on-miss host quirk (GAP-4, inherited): an ok reply with no
 * text reports the fixed copy 'permission updated' — unchanged.
 */
async function runPermissionLine(line: string, ctx: ExecutorContext, onNote?: NoteSink): Promise<ExecutorResult> {
	try {
		const res = await fetch(`/api/dsh/session/${encodeURIComponent(ctx.sessionId)}/permission`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ line })
		});
		const body = (await res.json().catch(() => null)) as
			| { ok?: boolean; text?: string; error?: { message?: string } }
			| null;
		if (body?.ok === true) {
			const note = body.text ?? 'permission updated';
			onNote?.(true, note);
			return { ok: true, note };
		}
		const note = body?.error?.message ?? `permission switch failed (HTTP ${res.status})`;
		onNote?.(false, note);
		return { ok: false, note };
	} catch (err) {
		const note = `permission switch failed (${err instanceof Error ? err.message : String(err)})`;
		onNote?.(false, note);
		return { ok: false, note };
	}
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

// ── Workspace Command (2026-09-15, The Workspace Command ADR D1–D5) ────────

/**
 * /workspace <full-path> [name] (ADR D1/D2): adopt a host folder into the
 * workspace registry — the typed twin of the sidebar's Add-workspace picker
 * (which is untouched, F9). Flow, per the ADR:
 *   D3  the handler expands a leading `~` against the HOST home (read off
 *       the directory-listing endpoint — the crumbs precedent) BEFORE the
 *       wire; a relative path usage-notes before any RPC.
 *   D4  a missing folder is the host's own refusal surfaced honestly with
 *       the mkdir remedy — DSI NEVER writes the filesystem, never retries.
 *   D2  the optional name renames ONLY what THIS command created
 *       (created=true); an already-adopted path skips the rename (the chip
 *       menu owns renames of existing workspaces) and says so.
 *   F9  a successful adopt fires the sidebar nudge `dsi:workspaces-changed`
 *       (the AddWorkspaceButton precedent) so the pill is immediate.
 * The success note carries the ready follow-up `/new <name-or-tail>` —
 * the recipe's next line, typed for the operator.
 */
async function runWorkspaceLine(
	wsPath: string | undefined,
	wsName: string | undefined,
	_ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	if (wsPath === undefined) {
		const usage = 'usage: /workspace <full-path> [name]';
		onNote?.(false, usage);
		return { ok: false, note: usage };
	}
	// D3: absolute-or-tilde only; a relative path is a usage note BEFORE
	// any RPC (the host would refuse it anyway — refuse it with the map).
	if (!wsPath.startsWith('~') && !wsPath.startsWith('/')) {
		const note = 'usage: /workspace <full-path> [name] — pass an absolute or ~ path (a relative one never reaches the wire)';
		onNote?.(false, note);
		return { ok: false, note };
	}
	let path = wsPath;
	if (path.startsWith('~')) {
		// D3: expand against the host home (the directory listing's `home`,
		// the same fact the picker's Home crumb shows). A failure is an
		// honest note — never a crash, never a raw ~ sent to the host.
		try {
			const res = await fetch('/api/dsh/directory');
			const body = (await res.json().catch(() => null)) as
				| { ok?: boolean; listing?: { home?: string } }
				| null;
			const home = body?.listing?.home;
			if (!res.ok || body?.ok !== true || typeof home !== 'string' || home === '') {
				// Real-host truth (2026-09-15 live demo): the browse capability can
				// be native-only — listDirectory refuses with the host's own code
				// and the message MUST ride the note (never swallowed), plus the
				// immediate remedy: the absolute path skips the expansion.
				const reason = body?.error?.message ?? `HTTP ${res.status}`;
				const note = `/workspace: could not read the host home (${reason}) — the ~ path was not expanded; use the absolute path (e.g. /Users/<you>/…) instead`;
				onNote?.(false, note);
				return { ok: false, note };
			}
			path = home + path.slice(1);
		} catch (err) {
			const note = `/workspace: could not read the host home (${err instanceof Error ? err.message : String(err)})`;
			onNote?.(false, note);
			return { ok: false, note };
		}
	}
	try {
		const res = await fetch('/api/dsh/workspaces', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ path })
		});
		const body = (await res.json().catch(() => null)) as
			| {
					ok?: boolean;
					created?: boolean;
					workspace?: { workspaceId?: string; title?: string; path?: string };
					error?: { message?: string };
			  }
			| null;
		if (!res.ok || body?.ok !== true || !body.workspace) {
			// D4: the host's refusal (missing folder, relative path, …) is the
			// note, plus the mkdir remedy — no retry, no client-side write.
			const reason = body?.error?.message ?? `HTTP ${res.status}`;
			const note = `/workspace refused: ${reason} — if the folder is missing, ask the agent to mkdir ${path} first (DSI never writes the filesystem)`;
			onNote?.(false, note);
			return { ok: false, note };
		}
		const wsId = typeof body.workspace.workspaceId === 'string' ? body.workspace.workspaceId : '';
		const hostTitle = typeof body.workspace.title === 'string' ? body.workspace.title : '';
		if (body.created === false) {
			// D2: renames are ONLY for what this command created — an
			// already-adopted path keeps its title (the chip menu owns it).
			const note = `/workspace: ${path} is already adopted as "${hostTitle}"${wsName !== undefined ? ' — the name is NOT applied to an existing workspace (rename it from the chip menu)' : ''} — try /new ${wsName ?? hostTitle}`;
			onNote?.(true, note);
			return { ok: true, note };
		}
		let finalTitle = hostTitle;
		if (wsName !== undefined) {
			// D2: created=true + a name → chain the rename. A rename FAILURE
			// does not un-adopt: the note frames it honestly, host message
			// surfaced verbatim (the registry row stays truthful via
			// workspace/follow).
			const rn = await fetch(`/api/dsh/workspaces/${encodeURIComponent(wsId)}/rename`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title: wsName })
			});
			const rnBody = (await rn.json().catch(() => null)) as
				| { ok?: boolean; error?: { message?: string } }
				| null;
			if (!rn.ok || rnBody?.ok !== true) {
				const reason = rnBody?.error?.message ?? `HTTP ${rn.status}`;
				const note = `/workspace: adopted ${path}, but the rename to "${wsName}" failed — ${reason} (the workspace keeps the host default title; rename it from the chip menu)`;
				onNote?.(true, note);
				window.dispatchEvent(new Event('dsi:workspaces-changed'));
				return { ok: true, note };
			}
			finalTitle = wsName;
		}
		// F9: the sidebar pill nudge — AddWorkspaceButton's precedent.
		window.dispatchEvent(new Event('dsi:workspaces-changed'));
		const note = `/workspace: adopted ${path}${wsName !== undefined ? ` as "${finalTitle}"` : ` as "${hostTitle}"`} — ready: /new ${wsName ?? finalTitle}`;
		onNote?.(true, note);
		return { ok: true, note };
	} catch (err) {
		const note = `/workspace failed (${err instanceof Error ? err.message : String(err)})`;
		onNote?.(false, note);
		return { ok: false, note };
	}
}

/**
 * The D5 resolution (2026-09-15): one workspace token against the host
 * registry (GET /api/dsh/sessions carries the rows). Match order — a
 * UNIQUE exact title first, then an exact canonical path; anything else is
 * an honest note (ambiguous → the candidates, path + title; miss → the
 * /workspace pointer). Never a guess, never a client-side registry.
 */
async function resolveWorkspaceToken(
	token: string
): Promise<{ path?: string; note?: string }> {
	let rows: Array<{ title: string; path: string }> = [];
	try {
		const res = await fetch('/api/dsh/sessions');
		const body = (await res.json().catch(() => null)) as
			| { ok?: boolean; workspaces?: Array<{ title?: unknown; path?: unknown }> }
			| null;
		if (!res.ok || body?.ok !== true || !Array.isArray(body.workspaces)) {
			return { note: `/new: the workspace registry is unavailable (HTTP ${res.status}) — try again` };
		}
		rows = body.workspaces
			.filter((w) => typeof w.title === 'string' && typeof w.path === 'string')
			.map((w) => ({ title: w.title as string, path: w.path as string }));
	} catch {
		return { note: '/new: the workspace registry is unavailable — try again' };
	}
	const byTitle = rows.filter((w) => w.title === token);
	if (byTitle.length === 1) return { path: byTitle[0].path };
	if (byTitle.length > 1) {
		return {
			note: `/new: "${token}" matches several workspaces — ${byTitle.map((w) => `${w.path} ("${w.title}")`).join(', ')} — repeat with the full path`
		};
	}
	const byPath = rows.find((w) => w.path === token);
	if (byPath !== undefined) return { path: byPath.path };
	if (rows.length === 0) {
		return { note: `/new: no workspace "${token}" — the registry is empty; adopt one with /workspace <full-path>` };
	}
	return { note: `/new: no workspace "${token}" — the registry holds: ${rows.map((w) => w.title).join(', ')}; adopt a new one with /workspace <full-path>` };
}
