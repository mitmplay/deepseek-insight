/**
 * Context-chip naming and affordances, shared by every surface that draws
 * a ContextInjection chip (the stage's prompt/context bubbles AND the
 * inline chip rows inside an assistant turn — The Turn Kept Whole, D2).
 *
 * All readers work off the entry's verbatim wire source (BC-11): the name
 * is the producer's own string (skill name · recall label · plugin string ·
 * kind string), never inferred from text.
 */
import type { DsiEntry } from '$lib/types';
import { addPanelFromSidebar } from '$lib/services/panels/panel-registry';

type Producer = NonNullable<Extract<DsiEntry, { kind: 'user-message' }>['meta']>;
type Source = Record<string, unknown> | undefined;

/** The wire-carried chip name for name-bearing producers, read from the
 *  entry's verbatim source (BC-11): the invoked skill's name, the first
 *  recall reference's label, the injecting plugin's own string, or an
 *  unknown kind string; undefined when none is readable (the chip falls
 *  back to its bare category). */
export function chipNameOf(meta: Producer, metaSource: Source): string | undefined {
	const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
	switch (meta) {
		case 'skill-invocation':
			return str(metaSource?.name);
		case 'recall': {
			const refs = metaSource?.references;
			if (!Array.isArray(refs)) return undefined;
			return str((refs[0] as { label?: unknown } | undefined)?.label);
		}
		case 'plugin':
			return str(metaSource?.plugin);
		case 'injected':
			return str(metaSource?.kind);
		default:
			return undefined;
	}
}

/**
 * The sender session of a subagent report/settled chip, read from the
 * entry's verbatim source (`subagent-report`/`subagent-settled` carry
 * `senderSessionId`): the open affordance targets that child panel.
 * Structural only — every other chip yields undefined (no affordance).
 */
function subagentSenderOf(meta: Producer, metaSource: Source): string | undefined {
	if (meta !== 'injected') return undefined;
	const kind = metaSource?.kind;
	if (kind !== 'subagent-report' && kind !== 'subagent-settled') return undefined;
	const sender = metaSource?.senderSessionId;
	return typeof sender === 'string' && sender !== '' ? sender : undefined;
}

/** The chip's `onopen` callback — present only on subagent report/settled
 *  chips whose source names a sender session. Opens the sender's panel
 *  through the floor registry (graceful no-op when no floor is mounted);
 *  the sender row is never focused. */
export function subagentOpenOf(meta: Producer, metaSource: Source): (() => void) | undefined {
	const sender = subagentSenderOf(meta, metaSource);
	return sender === undefined ? undefined : () => addPanelFromSidebar({ sessionId: sender, agentPreset: null });
}
