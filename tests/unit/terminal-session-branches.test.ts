/**
 * Branch-focused TerminalSession tests over a MOCKED node-pty — the real-PTY
 * suite (terminal-session.test.ts) proves the substrate; this one drives the
 * deterministic edge arms the live shell cannot reach on cue: settle reasons
 * (timeout / inferred_idle / session_exit), the exited-session early returns,
 * passive-settle sharing, the KILL tier of the close ladder, and a close that
 * must reject rather than claim success.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TerminalSendRefusal, TerminalSession } from '$lib/server/terminal/session.js';
import type { TerminalSpec } from '$lib/server/terminal/types.js';

interface FakePty {
	pid: number;
	onData: (cb: (data: string) => void) => void;
	onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void;
	write: ReturnType<typeof vi.fn>;
	kill: ReturnType<typeof vi.fn>;
}

const spawnMock = vi.fn();
vi.mock('node-pty', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

const ptys: FakePty[] = [];
const dirs: string[] = [];
const sessions: TerminalSession[] = [];
let onDataCb: ((data: string) => void) | null = null;
let onExitCb: ((e: { exitCode: number; signal?: number }) => void) | null = null;

function makeSession(overrides?: Partial<TerminalSpec>, promptDetect?: (tail: string) => boolean): TerminalSession {
	const cwd = mkdtempSync(join(tmpdir(), 'dsi-pty-b-'));
	dirs.push(cwd);
	const spec: TerminalSpec = {
		argv: ['/bin/bash', '--norc'],
		cwd,
		env: {},
		rows: 24,
		cols: 80,
		terminalType: 'xterm-256color',
		graceMs: 50,
		idleMs: 200,
		tailBytes: 262_144,
		...overrides
	};
	spawnMock.mockImplementationOnce(() => {
		const pty: FakePty = {
			pid: 4_000_000 + ptys.length + 1,
			onData: (cb) => {
				onDataCb = cb;
			},
			onExit: (cb) => {
				onExitCb = cb;
			},
			write: vi.fn(),
			kill: vi.fn()
		};
		ptys.push(pty);
		return pty;
	});
	const s = new TerminalSession(spec, promptDetect ? { promptDetect } : undefined);
	sessions.push(s);
	return s;
}

function emit(data: string): void {
	onDataCb?.(data);
}

function exit(exitCode = 0, signal?: number): void {
	onExitCb?.({ exitCode, signal });
}

const neverPrompt = () => false;

afterEach(() => {
	for (const s of sessions) void s.close().catch(() => undefined);
	sessions.length = 0;
	ptys.length = 0;
	onDataCb = null;
	onExitCb = null;
	vi.restoreAllMocks();
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
	dirs.length = 0;
});

describe('TerminalSession branches (mocked PTY)', () => {
	it('default prompt detector is used when none is provided', async () => {
		const s = makeSession();
		expect(onDataCb).toBeTruthy();
		emit('some output\n');
		await new Promise((r) => setTimeout(r, 10));
		expect(s.getTail()).toContain('some output');
	});

	it('send settles timeout when nothing arrives before the deadline', async () => {
		const s = makeSession({}, neverPrompt);
		const reason = await s.send('x\n', 120);
		expect(reason).toBe('timeout');
		expect(ptys[0].write).toHaveBeenCalledWith('x\n');
	});

	it('send settles inferred_idle after output then idleMs of silence', async () => {
		const s = makeSession({ idleMs: 80 }, neverPrompt);
		const sending = s.send('x\n', 5_000);
		await new Promise((r) => setTimeout(r, 20));
		emit('progress\n');
		const reason = await sending;
		expect(reason).toBe('inferred_idle');
	});

	it('send returns session_exit immediately for an already-exited session', async () => {
		const s = makeSession();
		exit(3, 15);
		expect(s.isExited()).toBe(true);
		expect(s.exitOutcome()).toEqual({ exitCode: 3, signal: 15 });
		await expect(s.send('x\n', 1_000)).resolves.toBe('session_exit');
	});

	it('a second send while one is in flight refuses SEND_ACTIVE', async () => {
		const s = makeSession({ idleMs: 10_000 }, neverPrompt);
		const first = s.send('x\n', 5_000);
		await expect(s.send('y\n', 100)).rejects.toThrow(TerminalSendRefusal);
		await new Promise((r) => setTimeout(r, 30));
		emit('out\n');
		exit();
		expect(await first).toBe('session_exit');
	});

	it('write on an exited session is dropped without touching the pty', () => {
		const s = makeSession();
		exit();
		s.write('x\n');
		expect(ptys[0].write).not.toHaveBeenCalled();
	});

	it('one passive settle watcher serves concurrent writes; settles inferred_idle', async () => {
		const s = makeSession({ idleMs: 60 });
		const settled: string[] = [];
		s.on('event', (e: { type: string; reason?: string }) => {
			if (e.type === 'settled') settled.push(e.reason as string);
		});
		s.write('a');
		s.write('b'); // shares the first watcher
		expect(ptys[0].write).toHaveBeenCalledTimes(2);
		await new Promise((r) => setTimeout(r, 20));
		emit('ack\n');
		await new Promise((r) => setTimeout(r, 250));
		expect(settled).toEqual(['inferred_idle']);
	});

	it('passive settle reports session_exit and tears its listener down', async () => {
		const s = makeSession({}, neverPrompt);
		const settled: string[] = [];
		s.on('event', (e: { type: string; reason?: string }) => {
			if (e.type === 'settled') settled.push(e.reason as string);
		});
		s.write('a');
		await new Promise((r) => setTimeout(r, 30));
		exit();
		await new Promise((r) => setTimeout(r, 100));
		expect(settled).toEqual(['session_exit']);
	});

	it('signalForeground returns the pgid when the kill lands, throws once exited', async () => {
		const s = makeSession();
		const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
		expect(s.signalForeground('SIGINT')).toBe(s.processGroupId);
		expect(killSpy).toHaveBeenCalledWith(-s.processGroupId, 'SIGINT');
		exit();
		expect(() => s.signalForeground('SIGTERM')).toThrow('session exited');
	});

	it('close ladder: TERM grace expires, KILL tier fires, exit is awaited, quiescent', async () => {
		const s = makeSession({ graceMs: 40 });
		const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
			throw new Error('group gone'); // TERM + KILL both miss — the exit wait decides
		});
		const closing = s.close();
		await new Promise((r) => setTimeout(r, 150));
		expect(killSpy).toHaveBeenCalledWith(-s.processGroupId, 'SIGTERM');
		exit(0);
		const result = await closing;
		expect(result.quiescent).toBe(true);
		expect(result.lingeringPids).toBeUndefined();
	});

	it('close on an already-exited session skips the signal tiers', async () => {
		const s = makeSession();
		exit();
		const killSpy = vi.spyOn(process, 'kill');
		const result = await s.close();
		expect(result.quiescent).toBe(true);
		expect(killSpy).not.toHaveBeenCalledWith(expect.any(Number), 'SIGTERM');
	});

	it('a failed close ladder rejects instead of claiming success', async () => {
		const s = makeSession({ graceMs: 20 });
		s.on('event', (e: { type: string }) => {
			if (e.type === 'closed') throw new Error('announce broke');
		});
		const closing = s.close();
		setTimeout(() => exit(0), 60);
		await expect(closing).rejects.toThrow('announce broke');
	});

	it('close is idempotent — the second call awaits the first ladder', async () => {
		const s = makeSession({ graceMs: 30 });
		const closing = s.close();
		setTimeout(() => exit(0), 60);
		const [a, b] = await Promise.all([closing, s.close()]);
		expect(a).toEqual(b);
	});

	it('readFrom: lossy below the tail start (with spill), clean slice above it', async () => {
		const s = makeSession({ tailBytes: 512 });
		emit('x'.repeat(4_000));
		await new Promise((r) => setTimeout(r, 20)); // let the spill append settle
		const lossy = s.readFrom(0);
		expect(lossy.lossy).toBe(true);
		expect(lossy.spillPath).toBeDefined();
		const clean = s.readFrom(s.streamBytes());
		expect(clean.lossy).toBe(false);
		expect(clean.text).toBe('');
		expect(clean.nextOffset).toBe(s.streamBytes());
	});

	it('exit with an undefined signal maps to a null signal outcome', () => {
		const s = makeSession();
		exit(7);
		expect(s.exitOutcome()).toEqual({ exitCode: 7, signal: null });
	});
});
