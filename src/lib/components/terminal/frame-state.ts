/**
 * TerminalPanel frame-state — the pure reducer between the SSE frames and
 * what the panel renders (spec 2026-09-24 Wave 4). No DOM, no xterm: the
 * host test drives this directly, the component only projects it.
 */
import type { TerminalSettleReason } from '$lib/server/terminal/types.js';

export interface TerminalPanelState {
	/** The last settle fact the stream delivered; null before the first send. */
	lastSettle: TerminalSettleReason | null;
	/** True once the closed frame arrived (stream over, terminal gone). */
	closed: boolean;
	/** True when the close ladder reported quiescence. */
	quiescent: boolean | null;
	/** True when an error frame arrived (stream-level failure). */
	errored: boolean;
}

export const initialTerminalPanelState: TerminalPanelState = {
	lastSettle: null,
	closed: false,
	quiescent: null,
	errored: false
};

export type TerminalPanelFrame =
	| { event: 'settled'; reason: TerminalSettleReason }
	| { event: 'closed'; quiescent: boolean; lingeringPids?: number[] }
	| { event: 'error'; error: string }
	| { event: 'exit'; outcome: { exitCode: number | null; signal: string | null } };

/** One frame in, next state out. Output frames are the xterm view's job —
 *  they never touch this state. */
export function reduceTerminalFrame(state: TerminalPanelState, frame: TerminalPanelFrame): TerminalPanelState {
	if (state.closed) return state;
	switch (frame.event) {
		case 'settled':
			return { ...state, lastSettle: frame.reason };
		case 'closed':
			return { ...state, closed: true, quiescent: frame.quiescent };
		case 'error':
			return { ...state, errored: true };
		case 'exit':
			return state;
	}
}
