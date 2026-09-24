/**
 * Runtime mirrors of the src terminal contract types (types erase at
 * runtime, so the drift test compares these literal lists — and the
 * satisfies-assertions below fail the type-check if the lists drift
 * from src/lib/server/terminal/types.ts).
 */
import type { TerminalRefusalCode, TerminalSettleReason, TerminalSignal } from '$lib/server/terminal/types.js';

export const TERMINAL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP', 'SIGHUP'] as const satisfies readonly TerminalSignal[];

export const TERMINAL_SETTLE_REASONS = ['stdin_read', 'inferred_idle', 'timeout', 'session_exit'] as const satisfies readonly TerminalSettleReason[];

export const TERMINAL_REFUSAL_CODES = ['SEND_ACTIVE', 'FOREIGN_SESSION', 'NO_SESSION', 'NOT_ENABLED', 'LINGERING_PIDS'] as const satisfies readonly TerminalRefusalCode[];

/** Member names TerminalSpec must carry (the no-defaults seam). */
export const TERMINAL_SPEC_MEMBERS = ['argv', 'cwd', 'env', 'rows', 'cols', 'terminalType', 'graceMs', 'idleMs'] as const;
