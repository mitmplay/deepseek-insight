/**
 * settings-home — The Settings Tree ADR (2026-09-18, D2): the DSI-LOCAL
 * data plane behind a session-less settings explorer. The DSH workspace
 * routes are session-scoped (every one resolves a DSH session's workspace
 * root by containment), so ~/.dsi and ~/.dsh cannot ride them: these
 * helpers serve the two homes directly, with the SAME containment refusal
 * discipline — a resolved path that escapes its home is a 400-class
 * refusal, never a listing or a byte.
 */
import { homedir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { promises as fs } from 'node:fs';

/** The settings home per target — verbatim, the explorer's `root`.
 *  `DSI_HOME_DIR` overrides homedir() (the same env-seam discipline as
 *  DSI_CONFIG_PATH; used by the settings-home tests). */
export function settingsHomeDir(home: 'dsi' | 'dsh'): string {
	const env = process.env.DSI_HOME_DIR;
	const base = env !== undefined && env.trim().length > 0 ? env : homedir();
	return home === 'dsi' ? join(base, '.dsi') : join(base, '.dsh');
}

/** Is the target a known home? (The routes' literal gate.) */
export function isSettingsHome(v: unknown): v is 'dsi' | 'dsh' {
	return v === 'dsi' || v === 'dsh';
}

/**
 * Resolve a root-relative path INSIDE its home. '' is the home itself;
 * anything that escapes (the classic `..` walk, an absolute smuggle) is
 * refused — null is the containment refusal, mapped to 400 by the routes.
 */
export function resolveSettingsHomePath(home: 'dsi' | 'dsh', rel: string): string | null {
	const base = resolve(settingsHomeDir(home));
	if (typeof rel !== 'string') return null;
	const target = resolve(base, rel);
	if (target !== base && !target.startsWith(base + sep)) return null;
	return target;
}

/** One listing row — the same DirEntry shape the DSH tree route emits. */
export interface SettingsHomeEntry {
	name: string;
	type: 'file' | 'directory' | 'other';
}

/** List one directory of a home: directories first, then natural name
 *  order (the WorkspaceDirectoryListing presentation contract). */
export async function listSettingsHomeDir(
	home: 'dsi' | 'dsh',
	rel: string
): Promise<{ entries: SettingsHomeEntry[]; truncated: boolean }> {
	const dir = resolveSettingsHomePath(home, rel);
	if (dir === null) throw new SettingsHomeRefusal('bad-path', 'path escapes the settings home');
	const names = (await fs.readdir(dir)).sort(new Intl.Collator(undefined, { numeric: true }).compare);
	const entries: SettingsHomeEntry[] = [];
	for (const name of names) {
		let type: SettingsHomeEntry['type'] = 'other';
		try {
			const st = await fs.stat(join(dir, name));
			type = st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other';
		} catch {
			type = 'other'; // unreadable stat — an honest 'other' row, never a crash
		}
		entries.push({ name, type });
	}
	entries.sort((a, b) => {
		const ad = a.type === 'directory' ? 0 : 1;
		const bd = b.type === 'directory' ? 0 : 1;
		return ad !== bd ? ad - bd : new Intl.Collator(undefined, { numeric: true }).compare(a.name, b.name);
	});
	return { entries, truncated: false };
}

/** The largest text file the settings explorer will open (bytes). */
export const SETTINGS_HOME_MAX_BYTES = 2 * 1024 * 1024;

/** Read one text file of a home. Binary/oversized is a refusal. */
export async function readSettingsHomeFile(
	home: 'dsi' | 'dsh',
	rel: string
): Promise<{ content: string; size: number }> {
	const file = resolveSettingsHomePath(home, rel);
	if (file === null) throw new SettingsHomeRefusal('bad-path', 'path escapes the settings home');
	const st = await fs.stat(file).catch(() => null);
	if (st === null || !st.isFile()) throw new SettingsHomeRefusal('not-file', 'not a readable file');
	if (st.size > SETTINGS_HOME_MAX_BYTES)
		throw new SettingsHomeRefusal('too-large', 'file exceeds the settings explorer size cap');
	const buf = await fs.readFile(file);
	if (buf.includes(0)) throw new SettingsHomeRefusal('binary', 'binary file — not a text surface');
	return { content: buf.toString('utf8'), size: st.size };
}

/** Write one text file of a home (the explorer file tab's save). */
export async function writeSettingsHomeFile(
	home: 'dsi' | 'dsh',
	rel: string,
	content: string
): Promise<void> {
	const file = resolveSettingsHomePath(home, rel);
	if (file === null) throw new SettingsHomeRefusal('bad-path', 'path escapes the settings home');
	if (typeof content !== 'string') throw new SettingsHomeRefusal('bad-content', 'content must be a string');
	if (Buffer.byteLength(content, 'utf8') > SETTINGS_HOME_MAX_BYTES)
		throw new SettingsHomeRefusal('too-large', 'content exceeds the settings explorer size cap');
	await fs.mkdir(dirname(file), { recursive: true });
	await fs.writeFile(file, content, 'utf8');
}

/** A typed refusal the routes map onto a 400-class response. */
export class SettingsHomeRefusal extends Error {
	constructor(
		public readonly code: string,
		message: string
	) {
		super(message);
	}
}