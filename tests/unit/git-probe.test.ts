/**
 * git-probe unit tests (Git Eye task 1.1-T): the gate's fresh-per-call
 * resolution, one-level detection over a REAL temp tree (.git file vs
 * directory vs symlink), and the porcelain parser against a REAL temp
 * git repo — plain entries, staged renames, the truncation cap, and the
 * missing-binary failure.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFile as nodeExecFile } from 'node:child_process';
import * as nodePath from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

const historyMock = vi.fn();
const ownerMock = vi.fn();

vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({
		workspaceOwnerSessionId: ownerMock,
		history: historyMock,
		ensureDownlinks: vi.fn(),
		subscribe: vi.fn(),
		// No live projections block in these fixtures — the gate falls back to
		// the tail page's own projections / knob events (same as +page.server).
		waitForProjections: vi.fn(async () => null)
	})
}));

// Pass raw events straight through — the gate test shapes them as DshRawEvent.
vi.mock('$lib/services/conversation/dsh-events', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/services/conversation/dsh-events')>();
	return { ...actual, historyToEvents: (events: unknown[]) => events };
});

import {
	GitUnavailableError,
	MAX_STATUS_ENTRIES,
	detectRepos,
	gitFileHead,
	gitGateEnabled,
	gitStatus,
	resolveEnclosingRepo
} from '$lib/server/git-probe';

const execFile = promisify(nodeExecFile);

function knobEvent(type: string, data: Record<string, string>) {
	return { type, data };
}

function historyPage(values: { events?: unknown[]; currentValue?: string }) {
	return {
		events: values.events ?? [],
		projections:
			values.currentValue === undefined
				? undefined
				: { values: { permissions: { currentValue: values.currentValue } } }
	};
}

async function runGit(cwd: string, ...args: string[]): Promise<string> {
	const out = await execFile('git', ['-C', cwd, ...args], { encoding: 'utf8' });
	return out.stdout;
}

/** A real git repo under a temp dir with the identity configured. */
async function makeRealRepo(): Promise<string> {
	const repo = await fs.mkdtemp(nodePath.join(tmpdir(), 'git-probe-repo-'));
	await runGit(repo, 'init');
	await runGit(repo, 'config', 'user.email', 'probe@dsi.local');
	await runGit(repo, 'config', 'user.name', 'probe');
	return repo;
}

afterEach(() => {
	historyMock.mockReset();
	ownerMock.mockReset();
});

describe('gitGateEnabled — the fresh-per-call gate (ADR D2)', () => {
	it('opens ONLY for the danger-full-access sandbox knob', async () => {
		ownerMock.mockResolvedValue('owner-1');
		historyMock.mockResolvedValue(
			historyPage({ events: [knobEvent('sandbox/mode', { mode: 'danger-full-access' })] })
		);
		await expect(gitGateEnabled('s1')).resolves.toBe(true);

		for (const mode of ['read-only', 'workspace-write', 'custom-mode']) {
			historyMock.mockResolvedValue(
				historyPage({ events: [knobEvent('sandbox/mode', { mode })] })
			);
			await expect(gitGateEnabled('s1')).resolves.toBe(false);
		}
	});

	it('falls back to the projections currentValue when no sandbox knob exists', async () => {
		ownerMock.mockResolvedValue('owner-1');
		historyMock.mockResolvedValue(historyPage({ currentValue: 'danger-full-access' }));
		await expect(gitGateEnabled('s1')).resolves.toBe(true);

		historyMock.mockResolvedValue(historyPage({ currentValue: 'read-only' }));
		await expect(gitGateEnabled('s1')).resolves.toBe(false);
	});

	it('closes when there is no signal at all, and resolves the OWNER session', async () => {
		ownerMock.mockResolvedValue('owner-9');
		historyMock.mockResolvedValue(historyPage({}));
		await expect(gitGateEnabled('child-session')).resolves.toBe(false);
		expect(ownerMock).toHaveBeenCalledWith('child-session');
		expect(historyMock).toHaveBeenCalledWith('owner-9');
	});
});

describe('detectRepos — one level over a REAL tree', () => {
	let dirs: string[] = [];

	afterEach(async () => {
		for (const d of dirs) await fs.rm(d, { recursive: true, force: true });
		dirs = [];
	});

	it('flags .git directories, .git FILES, and symlinked checkouts — nothing else', async () => {
		const dir = await fs.mkdtemp(nodePath.join(tmpdir(), 'git-probe-'));
		dirs.push(dir);
		await fs.mkdir(nodePath.join(dir, 'real-repo', '.git'), { recursive: true });
		await fs.mkdir(nodePath.join(dir, 'plain-dir'), { recursive: true });
		await fs.mkdir(nodePath.join(dir, 'worktree'), { recursive: true });
		await fs.writeFile(nodePath.join(dir, 'worktree', '.git'), 'gitdir: elsewhere');
		await fs.symlink(nodePath.join(dir, 'real-repo'), nodePath.join(dir, 'linked-repo'));
		await fs.writeFile(nodePath.join(dir, 'a-file.txt'), 'x');

		const map = await detectRepos(dir);
		expect(map.rootIsRepo).toBe(false);
		expect(map.repos['real-repo']).toBe(true);
		expect(map.repos['worktree']).toBe(true);
		expect(map.repos['linked-repo']).toBe(true);
		expect(map.repos['plain-dir']).toBe(false);
		expect(map.repos['a-file.txt']).toBeUndefined(); // files never appear
	});

	it('reports a root that is itself a repo', async () => {
		const dir = await fs.mkdtemp(nodePath.join(tmpdir(), 'git-probe-'));
		dirs.push(dir);
		await fs.mkdir(nodePath.join(dir, '.git'), { recursive: true });
		expect((await detectRepos(dir)).rootIsRepo).toBe(true);
	});
});

describe('gitStatus — real repo, porcelain parsing', () => {
	let repos: string[] = [];

	afterEach(async () => {
		for (const r of repos) await fs.rm(r, { recursive: true, force: true });
		repos = [];
		process.env.PATH = savedPath;
	});

	const savedPath = process.env.PATH ?? '';

	it('parses modified and untracked entries, spaces included', async () => {
		const repo = await makeRealRepo();
		repos.push(repo);
		await fs.writeFile(nodePath.join(repo, 'tracked.txt'), 'one\n');
		await runGit(repo, 'add', '.');
		await runGit(repo, 'commit', '-m', 'init');
		await fs.writeFile(nodePath.join(repo, 'tracked.txt'), 'two\n');
		await fs.writeFile(nodePath.join(repo, 'my folder.txt'), 'new\n');

		const result = await gitStatus(repo);
		expect(result.truncated).toBe(false);
		const byPath = new Map(result.files.map((f) => [f.path, f.code]));
		expect(byPath.get('tracked.txt')).toBe(' M');
		expect(byPath.get('my folder.txt')).toBe('??');
	});

	it('keeps the NEW path for a staged rename', async () => {
		const repo = await makeRealRepo();
		repos.push(repo);
		await fs.writeFile(nodePath.join(repo, 'original.txt'), 'x\n');
		await runGit(repo, 'add', '.');
		await runGit(repo, 'commit', '-m', 'init');
		await runGit(repo, 'mv', 'original.txt', 'renamed.txt');

		const result = await gitStatus(repo);
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe('renamed.txt');
		expect(result.files[0]?.code).toContain('R');
	});

	it('returns an empty answer on a clean repo', async () => {
		const repo = await makeRealRepo();
		repos.push(repo);
		await fs.writeFile(nodePath.join(repo, 'base.txt'), 'x\n');
		await runGit(repo, 'add', '.');
		await runGit(repo, 'commit', '-m', 'init');
		await expect(gitStatus(repo)).resolves.toEqual({ truncated: false, files: [] });
	});

	it('truncates honestly at the cap', async () => {
		const repo = await makeRealRepo();
		repos.push(repo);
		for (let i = 0; i < MAX_STATUS_ENTRIES + 25; i++) {
			await fs.writeFile(nodePath.join(repo, 'f' + i + '.txt'), 'x\n');
		}
		const result = await gitStatus(repo);
		expect(result.files).toHaveLength(MAX_STATUS_ENTRIES);
		expect(result.truncated).toBe(true);
	});

	it('raises GitUnavailableError when the git binary is missing', async () => {
		const repo = await makeRealRepo();
		repos.push(repo);
		process.env.PATH = '/nonexistent-git-eye';
		await expect(gitStatus(repo)).rejects.toBeInstanceOf(GitUnavailableError);
	});
});
describe('gitFileHead — read-only HEAD blob over a REAL repo', () => {
	let repos: string[] = [];
	const savedPath = process.env.PATH ?? '';

	afterEach(async () => {
		for (const r of repos) await fs.rm(r, { recursive: true, force: true });
		repos = [];
		process.env.PATH = savedPath;
	});

	it('returns the committed text for a tracked file', async () => {
		const repo = await makeRealRepo();
		repos.push(repo);
		await fs.writeFile(nodePath.join(repo, 'src.txt'), 'before version\n');
		await runGit(repo, 'add', '.');
		await runGit(repo, 'commit', '-m', 'init');
		await expect(gitFileHead(repo, 'src.txt')).resolves.toBe('before version\n');
	});

	it('resolves null for an untracked or never-committed path', async () => {
		const repo = await makeRealRepo();
		repos.push(repo);
		await runGit(repo, 'commit', '--allow-empty', '-m', 'empty');
		await fs.writeFile(nodePath.join(repo, 'new.txt'), 'x\n');
		await expect(gitFileHead(repo, 'new.txt')).resolves.toBeNull();
		await expect(gitFileHead(repo, 'never/existed.txt')).resolves.toBeNull();
	});

	it('returns the HEAD version even when the worktree has moved on', async () => {
		const repo = await makeRealRepo();
		repos.push(repo);
		await fs.writeFile(nodePath.join(repo, 'f.txt'), 'committed\n');
		await runGit(repo, 'add', '.');
		await runGit(repo, 'commit', '-m', 'init');
		await fs.writeFile(nodePath.join(repo, 'f.txt'), 'dirty worktree\n');
		await expect(gitFileHead(repo, 'f.txt')).resolves.toBe('committed\n');
	});

	it('throws before git runs on traversal or absolute rel paths', async () => {
		const repo = await makeRealRepo();
		repos.push(repo);
		await expect(gitFileHead(repo, '../escape.txt')).rejects.toThrow(/repo-relative/);
		await expect(gitFileHead(repo, '/etc/passwd')).rejects.toThrow(/repo-relative/);
		await expect(gitFileHead(repo, '')).rejects.toThrow(/repo-relative/);
	});

	it('raises GitUnavailableError when the git binary is missing', async () => {
		const repo = await makeRealRepo();
		repos.push(repo);
		await fs.writeFile(nodePath.join(repo, 'c.txt'), 'x\n');
		await runGit(repo, 'add', '.');
		await runGit(repo, 'commit', '-m', 'init');
		process.env.PATH = '/nonexistent-git-eye';
		await expect(gitFileHead(repo, 'c.txt')).rejects.toBeInstanceOf(GitUnavailableError);
	});
});

describe('resolveEnclosingRepo — deepest repo prefix wins', () => {
	let dirs: string[] = [];

	afterEach(async () => {
		for (const d of dirs) await fs.rm(d, { recursive: true, force: true });
		dirs = [];
	});

	it('uses the root itself when it is a repo', async () => {
		const dir = await fs.mkdtemp(nodePath.join(tmpdir(), 'enc-repo-'));
		dirs.push(dir);
		await fs.mkdir(nodePath.join(dir, '.git'), { recursive: true });
		await expect(resolveEnclosingRepo(dir, 'a/b/c.txt')).resolves.toEqual({ repo: dir, rel: 'a/b/c.txt' });
	});

	it('walks to the DEEPEST repo ancestor directory', async () => {
		const dir = await fs.mkdtemp(nodePath.join(tmpdir(), 'enc-nest-'));
		dirs.push(dir);
		const nested = nodePath.join(dir, 'work', 'repo');
		await fs.mkdir(nodePath.join(nested, '.git'), { recursive: true });
		await fs.mkdir(nodePath.join(dir, 'work', 'plain'), { recursive: true });
		await expect(resolveEnclosingRepo(dir, 'work/repo/src/x.ts')).resolves.toEqual({ repo: nested, rel: 'src/x.ts' });
		await expect(resolveEnclosingRepo(dir, 'work/plain/y.ts')).resolves.toBeNull();
	});

	it('refuses traversal-shaped and empty rel paths with null', async () => {
		const dir = await fs.mkdtemp(nodePath.join(tmpdir(), 'enc-bad-'));
		dirs.push(dir);
		await expect(resolveEnclosingRepo(dir, '')).resolves.toBeNull();
	});
});

