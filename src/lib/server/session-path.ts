/**
 * session-path — the session directory resolver (The Session Full Path,
 * ADR D2, 2026-09-14). Given the sessions root and a session id, answers
 * the ABSOLUTE on-disk session directory or null.
 *
 * The scan observes the disk; it never re-implements DSH's projectKey/
 * encodeSegment (rejected alternative — any twin drifts). On disk, a
 * session owns <root>/<projectKey>/<dir-for-id>/ where <projectKey> is
 * the lossy encoded cwd — exactly why DSI must NOT recompute it: the
 * scan walks the root's project directories (one level) and matches
 * LITERAL directory names inside each. Two naming generations exist
 * (RCA 2026-09-14, both verified on disk and against DSH
 * session-persistence-jsonl/src/format.ts:266 — `sessionDir` joins
 * `encodeSegment(id)`, which keeps UUID chars intact, so current DSH
 * names the directory by the BARE id):
 *
 *   <id>            — current generation (format.ts sessionDir)
 *   session-<id>    — legacy generation (still on disk)
 *
 * Null on: no match, root missing, ANY read error — the caller answers
 * 404 (a guessed path never ships; the Delete Gap rule). A FILE with a
 * candidate's name is ignored (directory check). If DSH ever renames
 * again, the scan returns null and the button honestly disappears —
 * no wrong data ships (the ADR's weakest-point answer).
 *
 * Pure by contract: no config imports, no homedir(), no HTTP — the route
 * owns both the root's provenance and the response shape.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Literal directory names that may hold the session, newest first. */
const CANDIDATES = (sessionId: string): string[] => [sessionId, `session-${sessionId}`];

/** Resolve `<root>/<projectDir>/{<id>,session-<id>}` when it is a real directory. */
export async function resolveSessionPath(root: string, sessionId: string): Promise<string | null> {
	const wanted = new Set(CANDIDATES(sessionId));
	let projects;
	try {
		projects = await readdir(root, { withFileTypes: true });
	} catch {
		return null;
	}
	for (const project of projects) {
		if (!project.isDirectory()) continue;
		let children;
		try {
			children = await readdir(join(root, project.name), { withFileTypes: true });
		} catch {
			continue; // an unreadable project dir is not a 404 of the whole scan
		}
		const hit = children.find((child) => wanted.has(child.name) && child.isDirectory());
		if (hit) return join(root, project.name, hit.name);
	}
	return null;
}
