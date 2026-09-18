/**
 * git-probe — the DSI server's gated git eye (ADR 2026-09-12, The Git Eye,
 * D1/D2/D5): the ONE place that looks at the filesystem on the browser's
 * behalf. Detection is pure node:fs over a SINGLE directory level (a
 * .git file flags like a .git directory — the worktree/submodule form);
 * status is a read-only `git status --porcelain=v1 -z` child run with a
 * bounded result. Every entry point routes through the gate: the owning
 * session's sandbox mode must be danger-full-access, resolved FRESH per
 * call from the ledger tail (folded knob events first, the projections
 * baseline second) — the gate is never cached, and callers must treat a
 * closed gate as final (the route answers enabled:false without touching
 * the filesystem). The DSH host is never asked: no git RPC exists there
 * and this module deliberately does not add one (ADR D1).
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';

import { getDshConnection } from './dsh-connection';
import {
	FULL_ACCESS_PRESET,
	filterKnobEvents,
	foldKnobs
} from '$lib/services/conversation/permission-state';
import { historyToEvents } from '$lib/services/conversation/dsh-events';

/** Which immediate children of a level are repo roots, plus the level itself. */
export interface RepoMap {
	/** The probed directory itself hosts a .git entry. */
	rootIsRepo: boolean;
	/** Child DIRECTORY name → it hosts a .git entry. Files never appear. */
	repos: Record<string, boolean>;
}

/** One porcelain entry: the two-letter XY code + repo-relative path. */
export interface GitStatusEntry {
	code: string;
	path: string;
}

/** Bounded git-status result. */
export interface GitStatus {
	truncated: boolean;
	files: GitStatusEntry[];
}

/** git status ran and the git binary is not installed on this machine. */
export class GitUnavailableError extends Error {
	constructor() {
		super('the git binary is not available on the DSI server machine');
		this.name = 'GitUnavailableError';
	}
}

/** Hard cap on one status answer (ADR: bounded results, truncation is honest). */
export const MAX_STATUS_ENTRIES = 500;
/**
 * Path containment for the status route: the requested repo must BE the
 * workspace root or live inside it, compared over REALPATHS (a symlinked
 * checkout cannot smuggle a path out). Best-effort: a root that cannot be
 * real-pathed (vanished mid-request) counts as outside — refuse, never
 * guess.
 */
export async function isInsideRoot(root: string, repo: string): Promise<boolean> {
	try {
		const [rootReal, repoReal] = await Promise.all([fs.realpath(root), fs.realpath(repo)]);
		return repoReal === rootReal || repoReal.startsWith(rootReal + nodePath.sep);
	} catch {
		return false;
	}
}

/** Wall-clock cap on one git child run. */
const GIT_TIMEOUT_MS = 10_000;
/** Output cap on one git child run (porcelain is ~100 bytes/entry; generous). */
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

/**
 * The gate (ADR D2): the owning session's effective sandbox mode must be
 * danger-full-access. Resolved fresh per call — owner session first (a
 * sub-agent id is refused by the host, the same as the tree route), then
 * the ledger tail: the folded sandbox/mode knob wins; without one, the
 * tail projections' permissions.currentValue is the baseline (the Access
 * chip's own source). No signal at all closes the gate.
 */
export async function gitGateEnabled(sessionId: string): Promise<boolean> {
	const conn = getDshConnection();
	const owner = await conn.workspaceOwnerSessionId(sessionId);
	// The knob events + tail-page projections are EMPTY for a session the
	// operator launched full-access from the host side (a preset start writes
	// no knob record) — the LIVE projection baseline is the same source the
	// Access chip's first paint uses (+page.server: waitForProjections).
	conn.ensureDownlinks();
	conn.subscribe(owner);
	const [page, live] = await Promise.all([
		conn.history(owner),
		conn.waitForProjections(owner).catch(() => null)
	]);
	const knobs = foldKnobs(filterKnobEvents(historyToEvents(page.events)));
	if (knobs.sandbox !== null) return knobs.sandbox === FULL_ACCESS_PRESET;
	const values = live?.values ?? page.projections?.values ?? {};
	const permissions = values['permissions'] as { currentValue?: unknown } | undefined;
	return (
		typeof permissions?.currentValue === 'string' &&
		permissions.currentValue === FULL_ACCESS_PRESET
	);
}

/** Does this directory contain a .git entry (file OR directory)? */
async function isRepo(dir: string): Promise<boolean> {
	try {
		await fs.stat(nodePath.join(dir, '.git'));
		return true;
	} catch {
		return false;
	}
}

/**
 * Detect repos under ONE directory level: the directory itself plus each
 * immediate child that is a directory (symlinks resolved — a linked
 * checkout flags like a real one). A child whose stat fails (permissions,
 * race) is simply not a repo; a detection answer is never an error.
 */
export async function detectRepos(dir: string): Promise<RepoMap> {
	const dirents = await fs.readdir(dir, { withFileTypes: true });
	const repos: Record<string, boolean> = {};
	for (const dirent of dirents) {
		if (dirent.isDirectory()) {
			repos[dirent.name] = await isRepo(nodePath.join(dir, dirent.name));
			continue;
		}
		if (dirent.isSymbolicLink()) {
			try {
				const target = await fs.stat(nodePath.join(dir, dirent.name));
				if (target.isDirectory()) {
					repos[dirent.name] = await isRepo(nodePath.join(dir, dirent.name));
				}
			} catch {
				// Broken symlink — not a repo, not an error.
			}
		}
	}
	return { rootIsRepo: await isRepo(dir), repos };
}

/**
 * The repo that directly contains a root-relative workspace path: the
 * root itself when it is a repo, else the DEEPEST ancestor directory of
 * the path that hosts a .git entry. Null when no repo encloses the path
 * — the route answers honestly, the browser guesses nothing.
 */
export async function resolveEnclosingRepo(
	root: string,
	relPath: string
): Promise<{ repo: string; rel: string } | null> {
	const parts = relPath.split('/').filter((p) => p.length > 0);
	if (parts.length === 0) return null;
	if (await isRepo(root)) return { repo: root, rel: parts.join('/') };
	for (let i = parts.length - 1; i >= 1; i--) {
		const dir = nodePath.join(root, ...parts.slice(0, i));
		if (await isRepo(dir)) return { repo: dir, rel: parts.slice(i).join('/') };
	}
	return null;
}

/**
 * Read-only HEAD blob text for one repo-relative path: git show
 * HEAD:rel with the same child-run caps as status. A path git does not
 * know in HEAD (untracked or newly added) resolves to NULL — an honest
 * "no before-version", never an error. Traversal attempts (.. segments,
 * absolute, empty) throw before git runs. A missing git binary raises
 * GitUnavailableError.
 */
export async function gitFileHead(repo: string, rel: string): Promise<string | null> {
	if (rel.length === 0 || rel.startsWith('/') || rel.split('/').includes('..')) {
		throw new Error('rel must be a non-empty repo-relative path without traversal');
	}
	return new Promise<string | null>((resolve, reject) => {
		execFile(
			'git',
			['-C', repo, 'show', 'HEAD:' + rel],
			{ timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER },
			(err, out) => {
				if (err === null) {
					resolve(out);
					return;
				}
				const code = (err as NodeJS.ErrnoException).code;
				if (code === 'ENOENT') {
					reject(new GitUnavailableError());
					return;
				}
				// git exits 128 when the path has no HEAD blob — the
				// untracked / newly-added case: an honest null, not an error.
				if (String(code) === '128') {
					resolve(null);
					return;
				}
				reject(err);
			}
		);
	});
}
/**
 * Porcelain parser shared by gitStatus and git-watch's baseline seed
 * (Index Pulse: the watcher's verify-by-status-diff must compare EXACTLY
 * what the route serves).
 */
export function parsePorcelainStatus(stdout: string): { truncated: boolean; files: GitStatusEntry[] } {
	const fields = stdout.split('\0');
	const files: GitStatusEntry[] = [];
	let truncated = false;
	for (let i = 0; i < fields.length - 1; i++) {
		const field = fields[i];
		if (field.length < 4) continue;
		if (files.length >= MAX_STATUS_ENTRIES) {
			truncated = true;
			break;
		}
		const code = field.slice(0, 2);
		const filePath = field.slice(3);
		if (code.includes('R') || code.includes('C')) i++;
		files.push({ code, path: filePath });
	}
	return { truncated, files };
}

/**
 * Read-only working-tree status for one repo root: `git status
 * --porcelain=v1 -z`, NUL-separated so spaces in paths need no unquoting.
 * Rename/copy entries carry the ORIGIN path as a second NUL field — the
 * origin is skipped (the NEW path is what the explorer opens). At
 * MAX_STATUS_ENTRIES the result truncates honestly. A missing git binary
 * raises GitUnavailableError; any other child failure propagates.
 */
export async function gitStatus(repo: string): Promise<GitStatus> {
	const stdout = await new Promise<string>((resolve, reject) => {
		execFile(
			'git',
			['-C', repo, 'status', '--porcelain=v1', '-z'],
			{ timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER },
			(err, out) => {
				if (err) {
					const code = (err as NodeJS.ErrnoException).code;
					if (code === 'ENOENT') reject(new GitUnavailableError());
					else reject(err);
					return;
				}
				resolve(out);
			}
		);
	});
	return parsePorcelainStatus(stdout);
}
