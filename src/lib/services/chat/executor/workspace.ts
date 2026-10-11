/**
 * executor/workspace — the /workspace adopt verb, the /permission line
 * verb, and the D5 workspace-token resolver, moved whole from
 * command-executor.ts (thin batch R3 lane B, ADR-0019 move-whole /
 * ADR-0022 W2): every wire byte, error string, and note text is
 * byte-identical. resolveWorkspaceToken is exported for the /new verb
 * (executor/session.ts); it was private in the shell — a private→public
 * seam widening with no signature change.
 */

import type { ExecutorContext, ExecutorResult, NoteSink } from '../command-executor';


/**
 * Execute one /permission… line through the typed route (commands/
 * execute host-side — never the model) and surface the host's own reply
 * text in the note. Bare /permission prints the current preset; an
 * error result (unknown preset, blocked downgrade) reports verbatim.
 * The null-on-miss host quirk (GAP-4, inherited): an ok reply with no
 * text reports the fixed copy 'permission updated' — unchanged.
 */
export async function runPermissionLine(line: string, ctx: ExecutorContext, onNote?: NoteSink): Promise<ExecutorResult> {
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
export async function runWorkspaceLine(
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
				| { ok?: boolean; listing?: { home?: string }; error?: { message?: string } }
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
export async function resolveWorkspaceToken(
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
