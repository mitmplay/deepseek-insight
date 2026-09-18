/**
 * injected-shelf — the pure selector over the conversation's dispatched
 * entries (The Loadinjected ADR D6/D7): WHICH documents did THIS
 * conversation receive, in the operator's order. Entries in, members out —
 * no component, no fetch, no store import: the transcript store (or a
 * test fixture) feeds it, and the shelf button / command executor read
 * what comes out.
 *
 * Membership (D7): the synthetic `system-prompt.md` — one member, the
 * latest `request/header` epoch — plus every instructions file named by
 * an injection envelope's `changes[].path`. Other injection producers
 * (runtime-context, skill-catalog, recall, plugin) are OUT of scope: they
 * are state snapshots, not documents, and their chips already serve them.
 * Order (D6): system-prompt first, then instructions files by first
 * injection. `metaSource` is wire data — path fields are validated, a
 * change without a usable path is skipped, never guessed.
 */
import type { DsiEntry } from '$lib/types';

/** The synthetic shelf name for the conversation's system prompt (ADR D7)
 *  — a shelf name, never a file. Sole home: the shelf manufactures the
 *  member; panel-rows imports it for the D7 title. */
export const SYSTEM_PROMPT_DISPLAY_PATH = 'system-prompt.md';

/** One shelf member — a document this conversation received. */
export interface InjectedShelfMember {
	/** The shelf identity: the synthetic system-prompt name or the
	 *  injected file's path as the harness printed it. The command's
	 *  exact-match key and the panel's displayPath (the dedupe pair's
	 *  document half, ADR D2/D5). */
	displayPath: string;
	/** The row's primary label — the display path's basename (D6); the
	 *  full path rides beside it as the row's secondary text. */
	label: string;
	/** Which of the two named families produced the member (D7). */
	origin: 'system-prompt' | 'instructions';
	/** True when the member arrived in the session's FIRST-LOAD baseline:
	 *  the synthetic system-prompt member, or a file from the
	 *  `baseline: true` envelope (the ContextInjection chips at session
	 *  start). False for members injected LATER (per-scope additions as
	 *  the session touches new workspaces) — the popup's divider boundary. */
	firstLoad: boolean;
}

/** Basename through '/' — wire paths are host paths; there is no shared
 *  path util in utils/ and the shelf needs exactly this one cut. */
function basenameOf(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Derive the conversation's injected shelf from its dispatched entries.
 * @param entries the conversation's transcript entries, in wire order.
 * @returns distinct members, system-prompt first, then instructions files
 *          by first injection; empty when the conversation received no
 *          member (the shelf button hides).
 */
export function injectedShelfFor(entries: readonly DsiEntry[]): InjectedShelfMember[] {
	const members: InjectedShelfMember[] = [];
	const seen = new Set<string>();
	// The synthetic member exists when ANY header epoch carried a system —
	// epochs collapse to ONE document (D7: an epoch change is a refresh,
	// never a second member).
	if (entries.some((e) => e.kind === 'system-prompt')) {
		members.push({
			displayPath: SYSTEM_PROMPT_DISPLAY_PATH,
			label: basenameOf(SYSTEM_PROMPT_DISPLAY_PATH),
			origin: 'system-prompt',
			firstLoad: true
		});
		seen.add(SYSTEM_PROMPT_DISPLAY_PATH);
	}
	for (const entry of entries) {
		if (entry.kind !== 'user-message' || entry.meta !== 'instructions') continue;
		// The FIRST-LOAD baseline envelope (`baseline: true` on the wire —
		// the ContextInjection chips at session start); every later
		// reconciliation (per-scope additions, updates) is not first load.
		const source = entry.metaSource as
			| { baseline?: unknown; changes?: { path?: unknown }[] }
			| undefined;
		const firstLoad = source?.baseline === true;
		for (const change of source?.changes ?? []) {
			const path = change?.path;
			if (typeof path !== 'string' || path.length === 0 || seen.has(path)) continue;
			seen.add(path);
			members.push({
				displayPath: path,
				label: basenameOf(path),
				origin: 'instructions',
				firstLoad
			});
		}
	}
	return members;
}

/** The executor's member resolution (ADR D4): an exact displayPath match
 *  first, then a UNIQUE basename match across the shelf. */
export type InjectedMemberResolution =
	| { ok: true; member: InjectedShelfMember }
	| { ok: false; candidates: InjectedShelfMember[] };

/**
 * The terminal-reachable copy value for a real injected file: the session
 * workspace joined with the display path (the harness prints changes[].path
 * relative to the session cwd). Three pass-throughs, never joined: an
 * absolute display path, a HOME-RELATIVE one (~/.dsh/AGENTS.md — shells
 * expand ~, so it is already terminal-usable), and a null workspace (the
 * relative name alone is what the record carries). The SYNTHETIC member
 * has no path at all — it is a shelf name, not a file (D7); callers copy
 * its TEXT.
 * @param workspace the session workspace cwd (null when unknown).
 * @param displayPath the member's shelf name.
 * @returns the copy value: joined when joinable, else the display path.
 */
export function injectedFullPath(workspace: string | null, displayPath: string): string {
	if (
		!workspace ||
		displayPath.startsWith('/') ||
		displayPath.startsWith('~')
	) {
		return displayPath;
	}
	return `${workspace.replace(/\/$/, '')}/${displayPath}`;
}

/** One resolved injected record — the logged text PLUS its provenance
 *  (the ledger position and wire time of the event it came from), so the
 *  panel can SHOW where a payload came from, not just assert it. */
export interface InjectedRecord {
	/** The logged document text. */
	text: string;
	/** The provenance event's seq — the ledger position to cite. */
	seq: number;
	/** The provenance event's wire time (ms epoch). */
	time: number;
}

/**
 * Slice ONE file's section out of a bundled instructions envelope. The
 * harness renders every file as a marker line + content (agent-instructions
 * render.ts: `Instructions from: p`, `Additional instructions from: p`
 * (one harness preamble paragraph first), `Updated instructions from: p`,
 * `Instructions removed: p` — sections joined by a blank line inside the
 * `<system-reminder>` frame), so the per-file content is recoverable
 * verbatim. The envelope body alone is a CLUB of every rendered file —
 * never one file's text; serving it whole would answer the command with
 * files it did not ask for.
 * @param text the envelope entry's dispatched text, verbatim.
 * @param displayPath the file whose section to slice.
 * @returns the file's own section content, or null when the render has no
 *          section for it (budget-omitted files render no section).
 */
function instructionSectionOf(text: string, displayPath: string): string | null {
	const shapes: Array<{ marker: string; preamble: boolean }> = [
		{ marker: `Instructions from: ${displayPath}\n\n`, preamble: false },
		{ marker: `Additional instructions from: ${displayPath}\n\n`, preamble: true },
		{ marker: `Updated instructions from: ${displayPath}\n\n`, preamble: true },
		{ marker: `Instructions removed: ${displayPath}\n\n`, preamble: false }
	];
	for (const shape of shapes) {
		const at = text.indexOf(shape.marker);
		if (at === -1) continue;
		let slice = text.slice(at + shape.marker.length);
		if (shape.preamble) {
			// Additional/Updated styles carry a one-paragraph harness preamble
			// between the marker and the file content — drop it.
			const p = slice.indexOf('\n\n');
			if (p !== -1) slice = slice.slice(p + 2);
		}
		let end = slice.length;
		for (const stop of [
			'\n\nInstructions from: ',
			'\n\nAdditional instructions from: ',
			'\n\nUpdated instructions from: ',
			'\n\nInstructions removed: ',
			'\n</system-reminder>'
		]) {
			const stopAt = slice.indexOf(stop);
			if (stopAt !== -1 && stopAt < end) end = stopAt;
		}
		return slice.slice(0, end).replace(/\n+$/, '');
	}
	return null;
}

/**
 * Resolve one member's LOGGED record (ADR D1/D7): the synthetic
 * system-prompt member reads the LATEST request/header epoch; an
 * instructions member reads the LATEST envelope naming the displayPath and
 * SLICES the file's own section out of the bundled render — the command
 * asks for a FILE, so the payload is that file's content, never the club.
 * Pure over the entries — the caller supplies whatever transcript snapshot
 * it holds; null = the record is not in it (the honest missing-record
 * state, never a fetch, and never another file's content).
 * @param entries the conversation's transcript entries, in wire order.
 * @param displayPath the member's shelf name.
 * @returns the record with provenance, or null when absent.
 */
export function injectedRecordFor(
	entries: readonly DsiEntry[],
	displayPath: string
): InjectedRecord | null {
	if (displayPath === SYSTEM_PROMPT_DISPLAY_PATH) {
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.kind === 'system-prompt') {
				return { text: entry.text, seq: entry.seq, time: entry.time };
			}
		}
		return null;
	}
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.kind !== 'user-message' || entry.meta !== 'instructions') continue;
		const changes = (entry.metaSource as { changes?: { path?: unknown }[] } | undefined)?.changes;
		if (Array.isArray(changes) && changes.some((c) => c?.path === displayPath)) {
			const section = instructionSectionOf(entry.text, displayPath);
			if (section === null) return null; // budget-omitted: no render, no lie
			return { text: section, seq: entry.seq, time: entry.time };
		}
	}
	return null;
}

/**
 * Resolve a command filename against the conversation's shelf.
 * @param entries the conversation's transcript entries, in wire order.
 * @param filename the command's filename token (exact displayPath or a
 *                 unique basename).
 * @returns the member on a match; otherwise every shelf member as
 *          candidates (the honest no-match note lists them) — empty
 *          candidates when the shelf itself is empty.
 */
export function resolveInjectedMember(
	entries: readonly DsiEntry[],
	filename: string
): InjectedMemberResolution {
	const shelf = injectedShelfFor(entries);
	const exact = shelf.find((m) => m.displayPath === filename);
	if (exact) return { ok: true, member: exact };
	const base = basenameOf(filename);
	const byBase = shelf.filter((m) => m.label === base);
	if (byBase.length === 1) return { ok: true, member: byBase[0] };
	// No match, or an ambiguous basename (two members share it) — both are
	// the candidates note; the executor never guesses (D4).
	return { ok: false, candidates: shelf };
}
