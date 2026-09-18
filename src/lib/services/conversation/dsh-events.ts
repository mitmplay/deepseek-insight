/**
 * dsh-events — mux/session events → DsiEntry render list. Pure mapping, no
 * I/O, no Svelte: the same functions run server-side (cold load from the
 * ledger, poll deltas in api-dsh) and client-side (store merge).
 *
 * Wire shapes pinned 2026-08-21 by live probes + harness sources, re-truthed
 * 2026-09-04 for the 0.1.3 ledger (packages/core/session/src/types.ts
 * SessionEventMap, known-event-types.ts):
 *
 *   user/message       data.content: [{type:'text',text}], data.id, data.source
 *   assistant/message  data.turn, data.step, data.message.content blocks
 *                      (final assembled message — finalizes the streaming
 *                       bubble). 0.1.3 ledger v2 embeds the step's exact
 *                       timed model stream beside it (data.stream); the
 *                       chunk events this file used to stream from are
 *                       gone — live text rides the follow's assistant-stream
 *                       tail (dsh-connection → store.applyLiveStream).
 *   tool/call          data.callId, data.name, data.arguments (raw JSON string)
 *   tool/result        data.message.source.callId, data.message.content[0]
 *                      ({type:'tool-result', content:[{type:'text'}], isError})
 *
 * Wave-1 tool truth (PRD §3.4): event.time (ms epoch) is on every entry;
 * tool/call keeps the raw arguments (argsRaw) and is born status:'pending';
 * tool/result carries resultText and gains durationMs at merge — computed as
 * result.time − call.time from the SAME wire events (display metadata, never
 * wall-clock guessing). status flips pending→pass/fail only when the paired
 * result arrives (callId), so an unfinished call stays honestly pending.
 *
 * Everything else is either a known-internal harness marker (silent — see
 * SILENT_TYPES) or an unknown type (forward-compat: rendered as a passthrough
 * chip so nothing the harness records disappears silently).
 *
 * Wave-2 readable rendering: reasoning-delta fragments merge into
 * `reasoning` (concat, finalize-wins — the exact rules text uses, keyed on
 * the same bubble id, but a SEPARATE field so the text path is untouched);
 * the finalized assistant/message's {type:'reasoning'} content block is
 * authoritative and replaces any streamed reasoning prefix. User messages
 * injected by the harness runtime-context plugin are detected by their
 * fixture-pinned source marker and flagged `meta:'runtime-context'` —
 * conservative: anything not matching the pinned marker stays a normal
 * bubble (BC-11: detection traces to wire source fields, never text guessing
 * alone).
 */

import type { DsiCodeDispatch, DsiEntry, DsiImageRef } from '$lib/types';
import { truncate } from '$lib/utils/truncate';

/** Raw DSH session event as both the mux (session/event) and the ledger
 * (session.history `event` member) deliver it. Structural, not imported from
 * the server layer: this module is shared by browser and server code (BC-2). */
export interface DshRawEvent {
	type: string;
	seq: number;
	time: number;
	data?: Record<string, unknown>;
	/** Optional presentation view riding next to ledger entries. */
	view?: unknown;
}

/**
 * Internal harness markers that never render in the transcript: policy
 * snapshots, turn/step bookkeeping, projections, retry plumbing. They are
 * durable truth for the harness, noise for a conversation page.
 *
 * NOT silent since 2026-09-01: `request/header` carries the rendered system
 * prompt (`header.system`) — transcript content in DSH's own Chat — and now
 * maps to a `system-prompt` entry. `request/context` stays silent (route
 * metadata, no user-visible text).
 */
const SILENT_TYPES: ReadonlySet<string> = new Set([
	'agent-preset/selected', // which agent setup was picked for this session — setup news, not chat
	'agent/inbox/spliced', // a queued message was edited/removed/rushed — the agent's to-do list changed, not the conversation
	'approval/decided', // someone answered a yes/no permission question — the asking + doing show up elsewhere
	'approval/policy', // the permission rules changed — house rules, not conversation
	'approval/asked', // interactive answering is out of scope (PRD §6) — chip would be dead UI
	'command/done', // a slash-command finished — you'll see what it DID, not the paperwork
	'command/run', // a slash-command started — same paperwork rule
	'compaction/end', // the harness finished squeezing old history into a summary — invisible maintenance
	'compaction/prune', // old trimmed history was dropped for real — invisible maintenance
	'compaction/start', // the harness started squeezing old history — invisible maintenance
	'compaction/summary', // the squeeze's summary text was saved — you'll see it via normal messages if it matters
	'feedback/record', // thumbs-up/down on a message was logged — ratings aren't chat
	'goal/change', // a long-running goal was created/updated — project management, not conversation
	'hook/invoked', // an automation script was triggered — plumbing behind the wall
	'hook/result', // that automation script finished — plumbing behind the wall
	'llm/retry', // the AI hiccuped and was re-asked — you only care that an answer eventually came
	'llm/retry-started', // the re-ask began — same hiccup rule
	// 0.1.3 ledger v2: one model attempt that settled WITHOUT a surface
	// message (failed, retried, cancelled, stream-error). Its content rides
	// the embedded stream; the retry's own assistant/message (or the turn's
	// turn/end error) is the transcript truth — the attempt itself is retry
	// plumbing, silent exactly like llm/retry. Falling through rendered one
	// unknown-event chip per retried step.
	'assistant/attempt',
	'permission/preset', // a preset of permission answers was applied — house rules, not chat
	'plan/mode', // plan mode turned on/off — a mode switch, not a message
	'request/context', // route metadata the harness attached to a request — invisible plumbing
	'sandbox/mode', // file-access safety rules changed — house rules, not chat
	'schedule/change', // a timer/schedule was set or cleared — calendar noise for a transcript
	// The ledger's own header line (identity · cwd · preset, no seq —
	// The Turn Kept Whole D5): known bookkeeping the workspace surface
	// already shows; falling through rendered an `ev:undefined` chip at
	// the top of every transcript.
	'session', // the log's own cover page (who/where/which setup) — shown elsewhere
	'session/end-seed', // seed data for a fresh forked session — plumbing, not chat
	'session/title', // the session got its name — shown in the sidebar, not the transcript
	'session/title-llm-request', // the AI was asked to think up that name — behind the scenes
	'step/end', // one internal step of a turn finished — bookkeeping
	'step/start', // one internal step of a turn began — bookkeeping
	// 0.1.5-alpha.2 parent-catalog fact (packages/subagent/subagent/src/catalog.ts):
	// one per delegation, payload is child id/timestamp — roster bookkeeping whose
	// visible side (the sub-agent's messages) arrives as its own events. Falling
	// through rendered one unknown-event chip per delegation.
	'subagent/catalog',
	'subagent/descriptor', // a sub-agent introduced itself — its actual messages show up normally
	'team/member', // someone joined/left the agent team — roster news, not chat
	'team/message/delivered', // a team message landed — the content arrives as its own message
	'team/message/queued', // a team message is waiting in line — same content-elsewhere rule
	'team/task', // a task was assigned to the team — project management, not conversation
	'todo/write', // the to-do list was updated — shown in its own panel, not the transcript
	// NOT silent since 2026-09-05: tool/ptc-dispatch(-start) fold onto the
	// parent run_code tool-call entry at merge (ADR D1/D2) — never standalone.
	// DSH 0.1.5-alpha.1 renamed the wire spellings from tool/code-dispatch(-start)
	// (commit bad4254d71); the host migrates old logs, so only the new names match.
	'turn/start', // a turn began — bookkeeping; what it produced is what you read
	'web/deepseek-search-llm-request' // a web-search prompt was sent to the AI — background prep, not chat
]);

/** Stable bubble id for one assistant step (chunk merge key). */
function bubbleId(turn: unknown, step: unknown): string {
	return `a:${String(turn)}:${String(step)}`;
}

/** Extract validated image refs from a message content array (Wave 3 task
 *  3.1). Wire shape: {type:'image', attachment:{attachmentId, mediaType,
 *  bytes, width, height, name?}} (ImageBlock). Structural validation at the
 *  wire boundary; malformed attachments are skipped, never guessed into
 *  shape. Returns undefined when none survive (lean payloads, text-only
 *  entries unchanged). */
function imageRefsOfContent(content: unknown): DsiImageRef[] | undefined {
	if (!Array.isArray(content)) return undefined;
	const refs: DsiImageRef[] = [];
	for (const part of content) {
		if (!part || typeof part !== 'object' || (part as { type?: unknown }).type !== 'image') continue;
		const attachment = (part as { attachment?: unknown }).attachment;
		if (!attachment || typeof attachment !== 'object') continue;
		const ref = attachment as Record<string, unknown>;
		if (
			typeof ref.attachmentId !== 'string' ||
			typeof ref.mediaType !== 'string' ||
			typeof ref.bytes !== 'number' ||
			typeof ref.width !== 'number' ||
			typeof ref.height !== 'number'
		) {
			continue;
		}
		refs.push({
			attachmentId: ref.attachmentId,
			mediaType: ref.mediaType,
			bytes: ref.bytes,
			width: ref.width,
			height: ref.height,
			...(typeof ref.name === 'string' ? { name: ref.name } : {})
		});
	}
	return refs.length > 0 ? refs : undefined;
}

/** Join the text parts of a message content array; non-text blocks ignored. */
function textOfContent(content: unknown): string {
	if (!Array.isArray(content)) return '';
	const parts: string[] = [];
	for (const part of content) {
		if (
			part &&
			typeof part === 'object' &&
			(part as { type?: unknown }).type === 'text' &&
			typeof (part as { text?: unknown }).text === 'string'
		) {
			parts.push((part as { text: string }).text);
		}
	}
	return parts.join('\n');
}

/**
 * Context-injection family detection (task 2.4; BC-11: fixture-pinned wire
 * markers — tests/unit/fixtures/context-injection-sources.json, live rc.8
 * ledger 2026-08-21). Harness-injected context user/messages carry a
 * structural `source` marker; each producer has its own shape:
 *
 *   runtime-context  source = { kind:'plugin',
 *                                 plugin:'@deepseek-ai/dsh-system-prompt',
 *                                 form:'snapshot', sections:[…] }
 *                    + text opens "Current runtime context."
 *   instructions     source = { kind:'agent-instructions', form:'instructions',
 *                              baseline, changes:[{action,set,scope,path,digest}] }
 *                    (AGENTS.md workspace instructions)
 *   skill-catalog    source = { kind:'skill-catalog', form:'catalog',
 *                              entries:[{name,description}] }
 *   skill-invocation source = { kind:'skill-invocation', name,
 *                              form:'instructions' }
 *                    (the rendered <skill_content> body injected after a
 *                     user-explicit skill load — SkillInvocationSource,
 *                     dsh-skill; `name` is the invoked skill, surfaced as
 *                     the chip label)
 *   compaction       source = { kind:'plugin', plugin:'compact',
 *                              compactionId, sourceCommandId? }
 *                    (the /compact checkpoint replacement user/message —
 *                     preamble + <compacted-summary> body —
 *                     CompactionCheckpointSource, dsh-compaction/checkpoint;
 *                     the full summary rides the message text, so the
 *                     compaction/* lifecycle events stay silent)
 *
 * The family is OPEN (2026-08-31 audit): MessageSourceMap is
 * merge-extensible and kind:'plugin' carries ANY plugin name. After the
 * five tailored producers, detection falls through exactly the way DSH's
 * own client does (ui-chat contextProvenance / message.ts):
 *
 *   plugin           source = { kind:'plugin', plugin:<name>, form? }
 *                    (every other injecting plugin — tool-jobs notices,
 *                     user-approval policy changes, hooks relays,
 *                     time-context / tmux-context snapshots, …; the chip
 *                     is NAMED after the wire plugin string)
 *   recall           source = { kind:'session-reference', form:'recall',
 *                              references:[{label,…}] }
 *                    (cross-session context prepared by the host;
 *                     named after the first reference label)
 *   injected         any other non-'user' source kind
 *                    (webhook notices, team messages, future kinds — the
 *                     chip is NAMED after the wire kind string; an unknown
 *                     producer stays visible, never a silent bubble)
 *
 * The 1.4-pinned fixture is the contract; the tailored producers require
 * the STRUCTURAL marker (source.kind + producer-specific form/keys) —
 * plain text that merely quotes the words never matches. Since the
 * 2026-08-31 audit, everything else NON-'user' still surfaces as a
 * fall-through chip (plugin name / recall label / kind string) instead of
 * posing as the operator's own bubble; only kind:'user' and source-less
 * messages stay ordinary bubbles.
 */
const RUNTIME_CONTEXT_PLUGIN = '@deepseek-ai/dsh-system-prompt';
const RUNTIME_CONTEXT_FORM = 'snapshot';
const RUNTIME_CONTEXT_TEXT_PREFIX = 'Current runtime context.';

/** Producer id = the chip's attribution + the entry's meta value. The
 * first five are tailored producers; the last three are the open-family
 * fall-through (merge-extensible wire, DSH-client parity). */
export type ContextInjectionProducer =
	| 'runtime-context'
	| 'instructions'
	| 'skill-catalog'
	| 'skill-invocation'
	| 'user-approval'
	| 'compaction'
	| 'plugin'
	| 'recall'
	| 'injected';

export function contextInjectionProducer(data: Record<string, unknown> | undefined): ContextInjectionProducer | undefined {
	const source = data?.source as { kind?: unknown; plugin?: unknown; form?: unknown } | undefined;
	if (!source || typeof source.kind !== 'string') return undefined;
	// The plugin family is open: every kind:'plugin' source is injected
	// context. Tailored members are recognized first; the rest fall through
	// to the generic chip, the way DSH's own client labels by plugin name.
	if (source.kind === 'plugin') {
		// Runtime-context: the pinned plugin + snapshot form; text prefix
		// corroborates (structural marker + text signal together, BC-11). A
		// snapshot without the prefix still falls through to 'plugin' below.
		if (
			source.plugin === RUNTIME_CONTEXT_PLUGIN &&
			source.form === RUNTIME_CONTEXT_FORM &&
			textOfContent(data?.content).startsWith(RUNTIME_CONTEXT_TEXT_PREFIX)
		) {
			return 'runtime-context';
		}
		// Compaction checkpoint: the pinned compact marker, exactly
		// dsh-compaction's isCompactCheckpointSource (kind + plugin only — no
		// form member). The /compact replacement user/message whose text
		// carries the <compacted-summary> body.
		if (source.plugin === 'compact') return 'compaction';
		// User-approval policy notices (2026-09-18): promoted from the open
		// family to a tailored producer — the chip label is catalog-sourced
		// (ctxChipUserApproval) instead of the raw wire string. Exact-string
		// match only: scoped siblings (@deepseek-ai/dsh-user-approval) stay
		// in the open family below.
		if (source.plugin === 'user-approval') return 'user-approval';
		// Open family: tool-jobs notices, user-approval policy changes,
		// hooks relays, time-context snapshots, … — the chip is named after
		// the wire plugin string at render time.
		return 'plugin';
	}
	// Instructions: agent-instructions kind + instructions form (AGENTS.md).
	if (source.kind === 'agent-instructions' && source.form === 'instructions') return 'instructions';
	// Skill-catalog: skill-catalog kind + catalog form (entries name+describe skills).
	if (source.kind === 'skill-catalog' && source.form === 'catalog') return 'skill-catalog';
	// Skill-invocation: skill-invocation kind + instructions form — the
	// <skill_content> body injected after a user-explicit skill load
	// (SkillInvocationSource, dsh-skill). Structural only: the skill name the
	// chip displays is read from the entry's metaSource at render time.
	if (source.kind === 'skill-invocation' && source.form === 'instructions') return 'skill-invocation';
	// Cross-session recall (session-reference, form 'recall'): the chip
	// names itself after the first reference label when one is readable.
	if (source.kind === 'session-reference') return 'recall';
	// Merge-extensible fall-through: any other non-'user' kind (webhook,
	// team-message, future kinds) stays visible, named after its kind —
	// the same documented default DSH's own client falls through on.
	if (source.kind !== 'user') return 'injected';
	// kind:'user' is the operator's own prompt and stays a bubble.
	return undefined;
}

/** tool/call display summary: harness view title when present, else the raw
 * args truncated through the shared util (task 2.1 promotion — single
 * truncation implementation; marker-less head, the chip owns affordances). */
function callSummary(event: DshRawEvent, argumentsRaw: string): string | undefined {
	const view = event.view as { view?: { title?: unknown } } | undefined;
	const title = view?.view?.title;
	if (typeof title === 'string' && title.length > 0) return title;
	const { head, truncated } = truncate(argumentsRaw, 120);
	if (head.length > 0) return truncated ? `${head}…` : head;
	return undefined;
}

/**
 * Map ONE raw event to its DsiEntry (or null when it renders nothing).
 *
 * Streaming bubbles are STORE state (applyLiveStream), never mapper output:
 * the live tail is seq-less and arrives beside the durable events, not as
 * one.
 */
export function entryForEvent(event: DshRawEvent): DsiEntry | null {
	if (SILENT_TYPES.has(event.type)) return null;
	const data = event.data;

	// A mapped-type event with NO data at all is uninterpretable — render it as
	// a passthrough chip rather than dropping it (pinned by the api-dsh tests:
	// seqs must survive even when a payload is absent).
	if (data === undefined) {
		return { kind: 'unknown-event', id: `ev:${event.seq}`, seq: event.seq, time: event.time, eventType: event.type };
	}

	switch (event.type) {
		case 'system/message': {
			// The 2026-09-10 node-zero mapping (Empty Prompt Popup ADR, D1/D2):
			// since DSH 0.1.5 (ee956c720d) the rendered system prompt is surface
			// node zero — a system/message event whose message.content text
			// blocks carry the prompt verbatim. Map to the SAME system-prompt
			// entry the header fallback produces, so SystemPromptChip and the
			// identical-text collapse keep working unchanged. Empty content is
			// the host's "no prompt" signal (SystemMessage contract) — no entry.
			const message = data?.message as { content?: unknown } | undefined;
			const text = textOfContent(message?.content);
			if (typeof text !== 'string' || text.length === 0) return null;
			return {
				kind: 'system-prompt',
				id: `sp:${event.seq}`,
				seq: event.seq,
				time: event.time,
				text
			};
		}

		case 'request/header': {
			// LEGACY fallback (2026-09-10, Empty Prompt Popup ADR, D3): the
			// 2026-09-01 un-silencing read the system prompt from this header
			// event, but DSH 0.1.5 removed header.system (the prompt became
			// surface node zero — the system/message case above). Pre-0.1.5
			// session logs still record the prompt here and nowhere else, so
			// the case stays for replay; on modern logs it returns null. One
			// entry per header that carries a system; identical-text collapse
			// is MERGE-time work in the store, never mapper state (scroll-up
			// pages map through fresh calls and cannot see earlier text).
			const system = (data?.header as { system?: unknown } | undefined)?.system;
			if (typeof system !== 'string' || system.length === 0) return null;
			return {
				kind: 'system-prompt',
				id: `sp:${event.seq}`,
				seq: event.seq,
				time: event.time,
				text: system
			};
		}

		case 'user/message': {
			const text = textOfContent(data?.content);
			const id = typeof data?.id === 'string' ? `u:${data.id}` : `u:seq:${event.seq}`;
			// Wave 3 (task 3.1): image blocks ride the same content array —
			// refs surface beside text (BC-A5: the render reads the ledger's
			// pointers, never the browser draft).
			const imageRefs = imageRefsOfContent(data?.content);
			// POC-3 W2 (task 2.4): the fixture-pinned context-injection FAMILY →
			// attributed chip, not paragraph (runtime-context detector became one
			// member; AGENTS.md instructions + skill-catalog join it).
			const producer = contextInjectionProducer(data);
			if (producer) {
				const src = data.source as Record<string, unknown> | undefined;
				return {
					kind: 'user-message',
					id,
					seq: event.seq,
					time: event.time,
					text,
					meta: producer,
					...(src !== undefined ? { metaSource: src } : {}),
					...(imageRefs !== undefined ? { imageRefs } : {})
				};
			}
			return {
				kind: 'user-message',
				id,
				seq: event.seq,
				time: event.time,
				text,
				...(imageRefs !== undefined ? { imageRefs } : {})
			};
		}

		// 0.1.3 ledger v2 removed the durable assistant/chunk event (streams
		// embed in assistant/message / assistant/attempt). Live streaming text
		// rides the follow's assistant-stream frames → the connection's live
		// tail → the store's applyLiveStream; this mapper never sees a chunk.

		case 'assistant/message': {
			const message = data?.message as { content?: unknown; source?: unknown } | undefined;
			// Wave 2 (task 2.3): the finalized message's {type:'reasoning'} block
			// is AUTHORITATIVE — it replaces whatever streamed as reasoning
			// prefix (live-probed shape: final messages carry reasoning blocks
			// beside text blocks).
			const reasoning = firstOfType(message?.content, 'reasoning') as { text?: unknown } | undefined;
			const reasoningText = typeof reasoning?.text === 'string' && reasoning.text.length > 0 ? reasoning.text : undefined;
			// DSH turn-usage route parity: message.source carries the provider/
			// model attribution shown in the usage popup (token-meter messageRoute).
			const source = message?.source as { provider?: unknown; model?: unknown } | undefined;
			const usage = usageOf(data?.usage, source);
			return {
				kind: 'assistant-message',
				id: bubbleId(data?.turn, data?.step),
				seq: event.seq,
				time: event.time,
				text: textOfContent(message?.content),
				streaming: false,
				...(reasoningText !== undefined ? { reasoning: reasoningText, reasoningStreaming: false } : {}),
				...(usage !== undefined ? { usage } : {})
			};
		}

			// Turn failure (2026-08-22, dead-turn bug): turn/end reason.kind ===
			// 'error' is the ONLY honest surface of a turn that died without a
			// reply (e.g. MISSING_CREDENTIAL). Without this, the prompt bubble
			// sits alone and the failure is invisible. A successful turn/end
			// stays silent (turn bookkeeping, not transcript). The assistant/chunk
			// finish {kind:'error'} duplicate is deliberately NOT mapped: one error
			// surface per turn, keyed on the terminal event.
		case 'turn/end': {
			const reason = data?.reason as { kind?: unknown; error?: { code?: unknown; message?: unknown } } | undefined;
			if (reason?.kind !== 'error') return null;
			const message = readStr(reason.error?.message) ?? 'turn ended with an error';
			return {
				kind: 'turn-error',
				id: `te:${event.seq}`,
				seq: event.seq,
				time: event.time,
				message,
				...(readStr(reason.error?.code) !== undefined ? { code: readStr(reason.error?.code) } : {})
			};
		}

		// ── PTC sub-dispatch fold (2026-09-05 ADR D1/D2): one partial entry per
		// sub-call, folded onto the parent tool-call entry at merge time ──
		// `-start` carries identity (name + args) for the live placeholder;
		// the settled event fills content/isError. Wire shapes pinned from
		// packages/core/tools/src/ptc.ts (binding + settle appends) and
		// session 7ec16d54's ledger.
		case 'tool/ptc-dispatch-start':
		case 'tool/ptc-dispatch': {
			const parentCallId = readStr(data?.parentCallId);
			const subCallId = readStr(data?.subCallId);
			if (parentCallId === undefined || subCallId === undefined) return null;
			const args = data?.arguments;
			return {
				kind: 'code-dispatch',
				id: `cd:${subCallId}`,
				seq: event.seq,
				time: event.time,
				parentCallId,
				subCallId,
				name: readStr(data?.name) ?? 'tool',
				...(args !== undefined ? { argsRaw: JSON.stringify(args) } : {}),
				settled: event.type === 'tool/ptc-dispatch',
				...(event.type === 'tool/ptc-dispatch'
					? { isError: data?.isError === true, contentText: textOfContent(data?.content) || undefined }
					: {})
			};
		}

		case 'tool/call': {
			const callId = readStr(data?.callId) ?? `seq:${event.seq}`;
			const argsRaw = readStr(data?.arguments);
			return {
				kind: 'tool-call',
				id: `tc:${callId}`,
				seq: event.seq,
				time: event.time,
				callId,
				toolName: readStr(data?.name) ?? 'tool',
				summary: callSummary(event, argsRaw ?? ''),
				argsRaw,
				status: 'pending' // merge flips to pass/fail when the paired tool/result arrives
			};
		}

		// ── tool-workflow lifecycle (2026-08-31): four events, ONE entry ──
		// Each maps to a workflow-run PARTIAL carrying only what the event
		// proves; mergeWorkflowRun folds partials by id (`wf:<runId>`).
		// Wire shapes pinned from packages/workflow/tool-workflow/src
		// (types.ts + index.ts recorder).
		case 'tool-workflow/run-start': {
			const runId = readStr(data?.runId) ?? `seq:${event.seq}`;
			return {
				kind: 'workflow-run',
				id: `wf:${runId}`,
				seq: event.seq,
				time: event.time,
				runId,
				name: readStr(data?.name) ?? 'workflow',
				status: 'running',
				agents: []
			};
		}
		case 'tool-workflow/agent-start': {
			const runId = readStr(data?.runId) ?? `seq:${event.seq}`;
			const memberSeq = typeof data?.seq === 'number' ? data.seq : -1;
			const phase = readStr(data?.phase);
			return {
				kind: 'workflow-run',
				id: `wf:${runId}`,
				seq: event.seq,
				time: event.time,
				runId,
				name: '', // the run-start partial owns the name
				status: 'running',
				agents: [
					{
						seq: memberSeq,
						label: readStr(data?.label) ?? `agent ${memberSeq}`,
						childId: readStr(data?.childId) ?? '',
						...(phase !== undefined ? { phase } : {}),
						status: 'running',
						startedAt: event.time
					}
				]
			};
		}
		case 'tool-workflow/agent-end': {
			const runId = readStr(data?.runId) ?? `seq:${event.seq}`;
			const memberSeq = typeof data?.seq === 'number' ? data.seq : -1;
			const outcome = readStr(data?.outcome);
			return {
				kind: 'workflow-run',
				id: `wf:${runId}`,
				seq: event.seq,
				time: event.time,
				runId,
				name: '',
				status: 'running',
				agents: [
					{
						seq: memberSeq,
						label: '',
						childId: '',
						status: outcome === 'completed' || outcome === 'failed' ? outcome : 'cancelled',
						startedAt: 0,
						endedAt: event.time
					}
				]
			};
		}
		case 'tool-workflow/run-end': {
			const runId = readStr(data?.runId) ?? `seq:${event.seq}`;
			const stopReason = readStr(data?.stopReason);
			return {
				kind: 'workflow-run',
				id: `wf:${runId}`,
				seq: event.seq,
				time: event.time,
				runId,
				name: '',
				status: stopReason === 'completed' ? 'completed' : stopReason === 'error' ? 'failed' : 'cancelled',
				agents: []
			};
		}

		case 'tool/result': {
			const message = data?.message as
				| { source?: { callId?: unknown }; content?: unknown }
				| undefined;
			const callId = readStr(message?.source?.callId) ?? `seq:${event.seq}`;
			const resultPart = firstOfType(message?.content, 'tool-result') as
				| { content?: unknown; isError?: unknown }
				| undefined;
			const resultText = textOfContent(resultPart?.content) || undefined;
			return {
				kind: 'tool-result',
				id: `tr:${callId}`,
				seq: event.seq,
				time: event.time,
				callId,
				toolName: '', // paired from the tool-call entry at merge time
				ok: !resultPart || resultPart.isError !== true,
				summary: resultText,
				resultText, // wire: tool-result block's text — full, untruncated
				...readViewFrom(event.view) !== undefined ? { readView: readViewFrom(event.view) } : {}
			};
		}

		default:
			// Unknown type — the harness recorded something this build does not
			// know. Render it as a chip rather than dropping it (forward-compat).
			// The payload rides verbatim so the popup renders it (the
			// 2026-09-18 empty-popup fix: workspace/changes ·
			// deliverables/presented opened nothing).
			return { kind: 'unknown-event', id: `ev:${event.seq}`, seq: event.seq, time: event.time, eventType: event.type, payload: data };
	}
}

/** Read a wire TokenUsage (assistant/message.data.usage) into its DSI
 * shape — structural and conservative: a non-numeric inputTokens declines
 * to undefined (the event carries no accounting). 2026-08-23. Route
 * attribution rides message.source when both parts are non-empty
 * (2026-09-09, DSH turn-usage parity). */
function usageOf(
	v: unknown,
	source?: { provider?: unknown; model?: unknown }
): import('$lib/types').DsiTokenUsage | undefined {
	const u = v as Record<string, unknown> | undefined;
	if (u === undefined || typeof u.inputTokens !== 'number' || typeof u.outputTokens !== 'number') {
		return undefined;
	}
	const opt = (n: unknown): number | undefined => (typeof n === 'number' ? n : undefined);
	const provider = typeof source?.provider === 'string' && source.provider.length > 0 ? source.provider : undefined;
	const model = typeof source?.model === 'string' && source.model.length > 0 ? source.model : undefined;
	return {
		inputTokens: u.inputTokens,
		outputTokens: u.outputTokens,
		...(opt(u.cacheReadTokens) !== undefined ? { cacheReadTokens: opt(u.cacheReadTokens) } : {}),
		...(opt(u.cacheWriteTokens) !== undefined ? { cacheWriteTokens: opt(u.cacheWriteTokens) } : {}),
		...(opt(u.reasoningTokens) !== undefined ? { reasoningTokens: opt(u.reasoningTokens) } : {}),
		...(provider !== undefined && model !== undefined ? { provider, model } : {})
	};
}

function readStr(v: unknown): string | undefined {
	return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function firstOfType(content: unknown, type: string): unknown {
	if (!Array.isArray(content)) return undefined;
	return content.find((p) => (p as { type?: unknown } | undefined)?.type === type);
}

/** Normalize a read-result presentation view (tool/result view.card ===
 * 'read') into DsiReadView. Structural and conservative: any malformed
 * member declines to undefined (the flat resultText path stays). BC-11:
 * the shape is read from the harness's own projection, never re-derived
 * by guessing at arguments. 2026-08-22. */
function readViewFrom(view: unknown): import('$lib/types').DsiReadView | undefined {
	const v = (view as { view?: Record<string, unknown> } | undefined)?.view;
	if (v === undefined || v.card !== 'read') return undefined;
	const path = readStr(v.path);
	if (path === undefined) return undefined;
	const offset = v.offset;
	const totalLines = v.totalLines;
	const lines = v.lines;
	if (typeof offset !== 'number' || typeof totalLines !== 'number' || !Array.isArray(lines)) return undefined;
	const out: import('$lib/types').DsiReadLine[] = [];
	for (const l of lines) {
		const line = l as { number?: unknown; text?: unknown };
		if (typeof line?.number !== 'number' || typeof line?.text !== 'string') return undefined;
		out.push({ number: line.number, text: line.text });
	}
	const lang = readStr(v.lang);
	return { path, offset, totalLines, lines: out, ...lang !== undefined ? { lang } : {} };
}

/**
 * Merge incoming DsiEntry deltas into an existing list (id-keyed, idempotent):
 *
 *   assistant-message, same id, finalized — REPLACES (the assembled message
 *       is authoritative over any streamed prefix, text AND reasoning; this
 *       is how the durable assistant/message finalizes the live-tail bubble
 *       folded by the store's applyLiveStream);
 *   any other kind, known id — ignored (retransmit);
 *   unknown id — appended.
 *
 *   (Ledger v2 removed the durable chunk events whose fragments CONCAT'ed
 *   here while streaming; the live tail carries the full accumulation each
 *   poll and replaces wholesale in the store, outside this merge.)
 *
 * Tool lifecycle (Wave 1, task 1.2): tool/call is born status:'pending';
 * a paired tool/result flips it to pass/fail (result.ok, i.e. isError on the
 * wire) and carries durationMs = result.time − call.time — both directions of
 * arrival (cold load has call+result together; polls may deliver result into
 * a list that already holds the call). An orphan result (no call in the list)
 * keeps its honest state: name unknown → 'tool', duration undefined.
 *
 * Also pairs tool-result entries with their tool-call by callId (fills
 * toolName). Server cold load and client poll deltas share these rules.
 */
export function mergeEntries(existing: DsiEntry[], incoming: DsiEntry[]): DsiEntry[] {
	const merged: DsiEntry[] = existing.map((e) => ({ ...e }));
	for (const entry of incoming) {
		const at = merged.findIndex((e) => e.id === entry.id);
		if (at === -1) {
			merged.push({ ...entry });
			continue;
		}
		const candidate = merged[at]!;
		if (candidate.kind === 'workflow-run' && entry.kind === 'workflow-run') {
			merged[at] = mergeWorkflowRun(candidate, entry);
			continue;
		}
		// code-dispatch partials share one id per sub-call (`cd:<subCallId>`);
		// unlike content-stable kinds, a settle ADDS facts — merge, never drop
		// (the fold below then attaches the merged partial).
		if (candidate.kind === 'code-dispatch' && entry.kind === 'code-dispatch') {
			if (entry.argsRaw !== undefined) candidate.argsRaw = entry.argsRaw;
			candidate.time = entry.time > candidate.time ? entry.time : candidate.time;
			if (entry.settled) {
				candidate.settled = true;
				candidate.isError = entry.isError;
				candidate.contentText = entry.contentText;
			}
			continue;
		}
		const prev = candidate as Extract<DsiEntry, { kind: 'assistant-message' }>;
		if (prev.kind === 'assistant-message' && entry.kind === 'assistant-message') {
			if (!entry.streaming) {
				// Finalize wins — but only where the final message actually CARRIES
				// the content: a finalize with no reasoning block does not erase
				// streamed reasoning (the wire never contradicted it), and a
				// finalize with no text keeps the streamed text.
				const next: Extract<DsiEntry, { kind: 'assistant-message' }> = { ...entry };
				if (next.reasoning === undefined && prev.reasoning !== undefined) {
					next.reasoning = prev.reasoning;
					next.reasoningStreaming = false; // the step finished
				}
				if (next.text === '') next.text = prev.text;
				merged[at] = next;
			}
			// A streaming entry can no longer arrive through this merge (the
			// live tail replaces in the store) — same id, streaming → ignore.
			continue;
		}
		// same id, non-assistant kinds are content-stable — ignore retransmits
	}

	// Pair tool results with their calls (callId → toolName), both directions of
	// arrival, then resolve lifecycle: status flip + durationMs from wire times.
	const calls = new Map<string, Extract<DsiEntry, { kind: 'tool-call' }>>();
	for (const e of merged) {
		if (e.kind === 'tool-call') calls.set(e.callId, e);
	}
	for (const e of merged) {
		if (e.kind !== 'tool-result') continue;
		const call = calls.get(e.callId);
		if (call) {
			// 'tool' is the orphan fallback — still "unknown", so a late-arriving
			// call (result-before-call poll order) re-pairs it with the real name.
			if (!e.toolName || e.toolName === '' || e.toolName === 'tool') e.toolName = call.toolName;
			if (!e.durationMs && e.time >= call.time) e.durationMs = e.time - call.time;
		}
		if (!e.toolName || e.toolName === '') e.toolName = 'tool';
		if (call && call.status === 'pending') call.status = e.ok ? 'pass' : 'fail';
	}

	foldCodeDispatches(merged);
	return merged;
}

/**
 * Fold `code-dispatch` partials onto their parent tool-call entries
 * (ADR D1/D2, 2026-09-05). Start and settled partials merge by subCallId —
 * a settle fills content/isError and never un-settles; a late start after a
 * settle keeps the settle's facts. Entries fold by parentCallId → the call's
 * `dispatches` list in `<n>` submission order. Orphans (no parent call in
 * the list) are dropped — the fold never guesses a parent. Idempotent:
 * retransmitted partials rewrite the same facts; the folded entry carries
 * fresh arrays, so re-running never aliases a prior list.
 */
function foldCodeDispatches(entries: DsiEntry[]): void {
	const bySub = new Map<string, Extract<DsiEntry, { kind: 'code-dispatch' }>>();
	for (const e of entries) {
		if (e.kind !== 'code-dispatch') continue;
		const prev = bySub.get(e.subCallId);
		if (prev === undefined) {
			bySub.set(e.subCallId, e);
			continue;
		}
		// Settle wins where it carried facts; identity fields match by id.
		prev.time = e.time > prev.time ? e.time : prev.time;
		if (e.argsRaw !== undefined) prev.argsRaw = e.argsRaw;
		if (e.settled) {
			prev.settled = true;
			prev.isError = e.isError;
			prev.contentText = e.contentText;
		}
	}
	if (bySub.size === 0) return;

	const calls = new Map<string, Extract<DsiEntry, { kind: 'tool-call' }>>();
	for (const e of entries) {
		if (e.kind === 'tool-call') calls.set(e.callId, e);
	}

	// Group by parent, then attach subCallId-ordered (trailing <n> of
	// `<callId>:code:<n>`; non-numeric tails sort last, stably).
	const grouped = new Map<string, Extract<DsiEntry, { kind: 'code-dispatch' }>[]>();
	for (const d of bySub.values()) {
		const list = grouped.get(d.parentCallId) ?? [];
		list.push(d);
		grouped.set(d.parentCallId, list);
	}
	const orderOf = (subCallId: string): number => {
		// 0.1.5-alpha.1 mints `:ptc:<n>`; the type-rename migration preserves old
		// payloads, so migrated V2 logs still carry `:code:<n>`.
		const m = /:(?:code|ptc):(\d+)$/.exec(subCallId);
		return m !== null ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
	};
	for (const [parentCallId, list] of grouped) {
		list.sort((a, b) => orderOf(a.subCallId) - orderOf(b.subCallId));
		const call = calls.get(parentCallId);
		if (call === undefined) continue; // orphan — dropped below, never guessed
		// Merge with dispatches a PREVIOUS merge already folded onto this
		// call (existing entries carry them; new partials supplement). The
		// SETTLED side owns isError/contentText — a stale retransmitted
		// start never un-settles a kept settle, and a settle outranks a
		// kept placeholder.
		const kept = new Map(call.dispatches?.map((d) => [d.subCallId, d]) ?? []);
		const next: DsiCodeDispatch[] = [];
		const seen = new Set<string>();
		for (const d of list) {
			seen.add(d.subCallId);
			const k = kept.get(d.subCallId);
			const winner = d.settled ? d : (k?.settled ? k : d);
			next.push({
				subCallId: d.subCallId,
				name: d.name,
				...(winner.argsRaw !== undefined ? { argsRaw: winner.argsRaw } : k?.argsRaw !== undefined ? { argsRaw: k.argsRaw } : {}),
				settled: d.settled || (k?.settled ?? false),
				...(winner.isError !== undefined ? { isError: winner.isError } : {}),
				...(winner.contentText !== undefined ? { contentText: winner.contentText } : {})
			});
		}
		for (const d of kept.values()) {
			if (!seen.has(d.subCallId)) next.push({ ...d });
		}
		next.sort((a, b) => orderOf(a.subCallId) - orderOf(b.subCallId));
		call.dispatches = next;
	}

	// Folded artifacts leave the render list; orphans leave with them.
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i]!.kind === 'code-dispatch') entries.splice(i, 1);
	}
}

/** Full ledger tail → merged render list (cold load; BC-4 reads the ledger). */
export function eventsToEntries(events: DshRawEvent[]): DsiEntry[] {
	const mapped = events.map(entryForEvent).filter((e): e is DsiEntry => e !== null);
	return collapseSystemPromptEntries(mergeEntries([], mapped));
}

/**
 * Collapse repeated `system-prompt` entries to one row per DISTINCT text
 * (2026-09-01): a request/header is appended per epoch — initial, resume,
 * change, series — so an uncollapsed transcript would repeat the identical
 * "System prompt" row after every host restart or tools-only header bump.
 * DSH's own Chat decides per header (`showsPrompt`); DSI cannot, because
 * scroll-up pages map through fresh calls with no earlier-page state — so
 * the rule is textual and stateless: keep a system-prompt row only when its
 * text differs from the last KEPT one. Pure, order-preserving, idempotent;
 * safe to re-run at every merge point (mapped batches, client deltas,
 * prepended older pages).
 */
export function collapseSystemPromptEntries(entries: DsiEntry[]): DsiEntry[] {
	let lastKept: string | undefined;
	const out: DsiEntry[] = [];
	for (const e of entries) {
		if (e.kind === 'system-prompt') {
			if (e.text === lastKept) continue;
			lastKept = e.text;
		}
		out.push(e);
	}
	return out;
}

/**
 * Fold ONE workflow-run partial into the running entry (2026-08-31).
 * Partials carry only what their event proved — run-start owns the name,
 * agent-start appends a member, agent-end settles a member by its member
 * seq (label/childId are NEVER overwritten by a settle partial's empty
 * strings), run-end sets the terminal status. Idempotent: a retransmitted
 * partial rewrites the same facts; a running status never un-settles a
 * terminal one.
 */
function mergeWorkflowRun(
	prev: Extract<DsiEntry, { kind: 'workflow-run' }>,
	incoming: Extract<DsiEntry, { kind: 'workflow-run' }>
): Extract<DsiEntry, { kind: 'workflow-run' }> {
	const agents = [...prev.agents];
	for (const a of incoming.agents) {
		const at = agents.findIndex((x) => x.seq === a.seq);
		if (at === -1) {
			agents.push({ ...a });
			continue;
		}
		agents[at] = {
			...agents[at],
			// A settle partial carries empty label/childId — never let one
			// erase identity; conversely a late-arriving start FILLS a stub.
			label: agents[at].label === '' && a.label !== '' ? a.label : agents[at].label,
			childId: agents[at].childId === '' && a.childId !== '' ? a.childId : agents[at].childId,
			startedAt: agents[at].startedAt > 0 ? agents[at].startedAt : a.startedAt,
			status: a.status !== 'running' ? a.status : agents[at].status,
			...(a.phase !== undefined ? { phase: a.phase } : {}),
			...(a.endedAt !== undefined ? { endedAt: a.endedAt } : {})
		};
	}
	return {
		...prev,
		seq: Math.max(prev.seq, incoming.seq),
		time: Math.max(prev.time, incoming.time),
		name: prev.name !== '' ? prev.name : incoming.name,
		status: incoming.status !== 'running' ? incoming.status : prev.status,
		agents
	};
}

/** Ledger HistoryEntry[] → raw events with their presentation views carried
 * (2026-08-22): the harness attaches `view` BESIDE `event` on each history
 * entry — a plain `.map((h) => h.event)` drops it, and the read-result file
 * rendering lost its typed data. Views merge shallowly; the event's own
 * member (if a wire ever carries one) wins. */
export function historyToEvents(history: Array<{ event: DshRawEvent; view?: unknown }>): DshRawEvent[] {
	return history.map((h) =>
		h.view === undefined || h.event.view !== undefined
			? h.event
			: { ...h.event, view: h.view }
	);
}
